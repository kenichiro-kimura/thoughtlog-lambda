import { describe, it, expect, vi } from "vitest";
import { GitHubAuthService } from "./authService";
import type { HttpClient } from "../utils/http";
import type { ISecretProvider } from "../interfaces/ISecretProvider";
import crypto from "crypto";

// ── GitHubAuthService.getInstallationToken ─────────────────────────────────────

// Generate a real RSA key pair so JWT signing succeeds.
const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function makeSecretProvider(pem: string | undefined): ISecretProvider {
    return {
        getPrivateKeyPem: vi.fn().mockResolvedValue(pem),
    };
}

describe("GitHubAuthService.getInstallationToken", () => {
    it("throws when appId is missing", async () => {
        const http: HttpClient = vi.fn();
        const service = new GitHubAuthService(undefined, "123", makeSecretProvider(privateKey), http);
        await expect(service.getInstallationToken()).rejects.toThrow("Missing env");
    });

    it("throws when installationId is missing", async () => {
        const http: HttpClient = vi.fn();
        const service = new GitHubAuthService("1", undefined, makeSecretProvider(privateKey), http);
        await expect(service.getInstallationToken()).rejects.toThrow("Missing env");
    });

    it("throws when privateKeyPem is missing", async () => {
        const http: HttpClient = vi.fn();
        const service = new GitHubAuthService("1", "123", makeSecretProvider(undefined), http);
        await expect(service.getInstallationToken()).rejects.toThrow(
            "Private key PEM retrieved from Secrets Manager is empty or invalid",
        );
    });

    it("returns the token from the GitHub API response", async () => {
        const http: HttpClient = vi.fn().mockResolvedValue({ token: "ghs_secret" });
        const service = new GitHubAuthService("42", "99", makeSecretProvider(privateKey), http);
        const token = await service.getInstallationToken();
        expect(token).toBe("ghs_secret");
    });

    it("calls the correct installations endpoint", async () => {
        const http: HttpClient = vi.fn().mockResolvedValue({ token: "tok" });
        const service = new GitHubAuthService("42", "99", makeSecretProvider(privateKey), http);
        await service.getInstallationToken();
        const calledUrl = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledUrl).toContain("/app/installations/99/access_tokens");
    });

    it("throws when GitHub API does not return a token", async () => {
        const http: HttpClient = vi.fn().mockResolvedValue({});
        const service = new GitHubAuthService("42", "99", makeSecretProvider(privateKey), http);
        await expect(service.getInstallationToken()).rejects.toThrow(
            "GitHub API did not return an installation token",
        );
    });
});
