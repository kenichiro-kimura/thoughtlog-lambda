import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { ISecretProvider } from "../interfaces/ISecretProvider";

export type { ISecretProvider };

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Fetches a PEM-encoded private key from AWS Secrets Manager at runtime, with in-memory caching. */
export class SecretsManagerSecretProvider implements ISecretProvider {
    private readonly client: SecretsManagerClient;
    private readonly ttlMs: number;
    private cachedValue: string | undefined;
    private cacheExpiresAt = 0;

    constructor(
        private readonly secretArn: string,
        client?: SecretsManagerClient,
        ttlMs: number = DEFAULT_TTL_MS,
    ) {
        this.client = client ?? new SecretsManagerClient({});
        this.ttlMs = ttlMs;
    }

    async getPrivateKeyPem(): Promise<string> {
        if (this.cachedValue && Date.now() < this.cacheExpiresAt) {
            return this.cachedValue;
        }
        const resp = await this.client.send(
            new GetSecretValueCommand({ SecretId: this.secretArn }),
        );
        const value = resp.SecretString;
        if (!value) {
            throw new Error(`Secret ${this.secretArn} has no SecretString value`);
        }
        this.cachedValue = value;
        this.cacheExpiresAt = Date.now() + this.ttlMs;
        return value;
    }
}
