import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { base64url, normalizePem, signJwtRS256 } from "./jwt";

// ── base64url ─────────────────────────────────────────────────────────────────

describe("base64url", () => {
    it("encodes a string without padding or unsafe characters", () => {
        const result = base64url("hello world");
        expect(result).not.toContain("=");
        expect(result).not.toContain("+");
        expect(result).not.toContain("/");
    });

    it("encodes a Buffer without padding", () => {
        const buf = Buffer.from([0xff, 0xfe, 0xfd]);
        const result = base64url(buf);
        expect(result).not.toContain("=");
        expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

// ── normalizePem ──────────────────────────────────────────────────────────────

const PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PEM_FOOTER = "-----END RSA PRIVATE KEY-----";
const DUMMY_BODY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("normalizePem", () => {
    it("returns undefined when input is undefined", () => {
        expect(normalizePem(undefined)).toBeUndefined();
    });

    it("returns an empty string when input is empty string", () => {
        expect(normalizePem("")).toBe("");
    });

    it("passes through a correctly formatted multiline PEM unchanged (modulo trailing whitespace)", () => {
        const multiline = `${PEM_HEADER}\n${DUMMY_BODY}\n${PEM_FOOTER}\n`;
        const result = normalizePem(multiline);
        expect(result).toContain(PEM_HEADER);
        expect(result).toContain(PEM_FOOTER);
        expect(result!.includes("\n")).toBe(true);
    });

    it("unescapes literal \\n sequences from env var serialization", () => {
        const withEscaped = `${PEM_HEADER}\\n${DUMMY_BODY}\\n${PEM_FOOTER}`;
        const result = normalizePem(withEscaped);
        expect(result!.includes("\n")).toBe(true);
    });

    it("strips surrounding quotes from env var format", () => {
        const quoted = `"${PEM_HEADER}\\n${DUMMY_BODY}\\n${PEM_FOOTER}"`;
        const result = normalizePem(quoted);
        expect(result).not.toMatch(/^"/);
        expect(result).not.toMatch(/"$/);
        expect(result).toContain(PEM_HEADER);
    });

    it("re-wraps a single-line PEM body at 64 characters", () => {
        const longBody = "A".repeat(200);
        const singleLine = `${PEM_HEADER}${longBody}${PEM_FOOTER}`;
        const result = normalizePem(singleLine);
        const lines = result!.split("\n").filter((l) => l && !l.startsWith("---"));
        expect(lines.every((l) => l.length <= 64)).toBe(true);
    });
});

// ── signJwtRS256 ──────────────────────────────────────────────────────────────

describe("signJwtRS256", () => {
    // Generate an RSA key pair dynamically so the test is self-contained.
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    it("produces a three-part JWT string", () => {
        const token = signJwtRS256({ iss: 1, iat: 0, exp: 9999999999 }, privateKey);
        const parts = token.split(".");
        expect(parts).toHaveLength(3);
    });

    it("header decodes to RS256 algorithm", () => {
        const token = signJwtRS256({ iss: 1 }, privateKey);
        const [headerB64] = token.split(".");
        const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
        expect(header.alg).toBe("RS256");
        expect(header.typ).toBe("JWT");
    });

    it("payload round-trips correctly", () => {
        const claims = { iss: 42, iat: 1000, exp: 2000 };
        const token = signJwtRS256(claims, privateKey);
        const [, payloadB64] = token.split(".");
        const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
        expect(decoded).toEqual(claims);
    });

    it("produces a signature verifiable with the corresponding public key", () => {
        const token = signJwtRS256({ iss: 1 }, privateKey);
        const [headerB64, payloadB64, sigB64] = token.split(".");
        const data = `${headerB64}.${payloadB64}`;
        const sig = Buffer.from(sigB64, "base64url");

        const verifier = crypto.createVerify("RSA-SHA256");
        verifier.update(data);
        expect(verifier.verify(publicKey, sig)).toBe(true);
    });
});
