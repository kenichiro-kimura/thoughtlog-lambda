import { describe, it, expect, vi } from "vitest";
import { SecretsManagerSecretProvider } from "./secretProvider";
import type { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-key";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----\n";

function makeMockClient(secretString: string | undefined): SecretsManagerClient {
    return {
        send: vi.fn().mockResolvedValue({ SecretString: secretString }),
    } as unknown as SecretsManagerClient;
}

describe("SecretsManagerSecretProvider", () => {
    it("returns SecretString from Secrets Manager", async () => {
        const client = makeMockClient(PEM);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        const result = await provider.getPrivateKeyPem();

        expect(result).toBe(PEM);
        expect(client.send).toHaveBeenCalledOnce();
        const cmd = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as GetSecretValueCommand;
        expect(cmd.input.SecretId).toBe(SECRET_ARN);
    });

    it("throws when SecretString is absent", async () => {
        const client = makeMockClient(undefined);
        const provider = new SecretsManagerSecretProvider(SECRET_ARN, client);
        await expect(provider.getPrivateKeyPem()).rejects.toThrow(SECRET_ARN);
    });
});
