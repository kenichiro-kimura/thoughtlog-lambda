import { describe, it, expect, vi } from "vitest";
import { SecretsManagerSecretProvider } from "./secretProvider";
import type { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-key";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----\n";
const OPENAI_API_KEY = "sk-test-key";
const SECRET_JSON = JSON.stringify({ github_private_key: PEM, openai_api_key: OPENAI_API_KEY });

function makeMockClient(secretString: string | undefined): SecretsManagerClient {
    return {
        send: vi.fn().mockResolvedValue({ SecretString: secretString }),
    } as unknown as SecretsManagerClient;
}

describe("SecretsManagerSecretProvider", () => {
    it("returns github_private_key from JSON secret", async () => {
        const client = makeMockClient(SECRET_JSON);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        const result = await provider.getPrivateKeyPem();

        expect(result).toBe(PEM);
        expect(client.send).toHaveBeenCalledOnce();
        const cmd = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as GetSecretValueCommand;
        expect(cmd.input.SecretId).toBe(SECRET_ARN);
    });

    it("returns openai_api_key from JSON secret", async () => {
        const client = makeMockClient(SECRET_JSON);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        const result = await provider.getOpenAiApiKey();

        expect(result).toBe(OPENAI_API_KEY);
    });

    it("throws when SecretString is absent", async () => {
        const client = makeMockClient(undefined);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        await expect(provider.getPrivateKeyPem()).rejects.toThrow(SECRET_ARN);
    });

    it("throws when secret is not valid JSON", async () => {
        const client = makeMockClient("not-json");
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        await expect(provider.getPrivateKeyPem()).rejects.toThrow("not valid JSON");
    });

    it("throws when github_private_key is missing from JSON", async () => {
        const client = makeMockClient(JSON.stringify({ openai_api_key: OPENAI_API_KEY }));
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        await expect(provider.getPrivateKeyPem()).rejects.toThrow("github_private_key");
    });

    it("throws when openai_api_key is missing from JSON", async () => {
        const client = makeMockClient(JSON.stringify({ github_private_key: PEM }));
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        await expect(provider.getOpenAiApiKey()).rejects.toThrow("openai_api_key");
    });

    it("returns cached value without calling Secrets Manager again within TTL", async () => {
        const client = makeMockClient(SECRET_JSON);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client, 60_000);

        const first = await provider.getPrivateKeyPem();
        const second = await provider.getPrivateKeyPem();

        expect(first).toBe(PEM);
        expect(second).toBe(PEM);
        expect(client.send).toHaveBeenCalledOnce();
    });

    it("reuses cached value across different getters within TTL", async () => {
        const client = makeMockClient(SECRET_JSON);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client, 60_000);

        await provider.getPrivateKeyPem();
        await provider.getOpenAiApiKey();

        expect(client.send).toHaveBeenCalledOnce();
    });

    it("refreshes the cache after TTL expires", async () => {
        vi.useFakeTimers();
        const client = makeMockClient(SECRET_JSON);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client, 1_000);

        await provider.getPrivateKeyPem();
        vi.advanceTimersByTime(2_000);
        await provider.getPrivateKeyPem();

        expect(client.send).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });
});
