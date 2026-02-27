import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { ISecretProvider } from "../interfaces/ISecretProvider";

export type { ISecretProvider };

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface AppSecrets {
    github_private_key: string;
    openai_api_key?: string;
}

/** Fetches secrets from AWS Secrets Manager at runtime, with in-memory caching.
 *  The secret must be a JSON string that contains github_private_key, and if you use
 *  OpenAI-related features it must also include openai_api_key.
 */
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

    private async fetchRaw(): Promise<string> {
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

    private async parseSecrets(): Promise<AppSecrets> {
        const raw = await this.fetchRaw();
        try {
            return JSON.parse(raw) as AppSecrets;
        } catch {
            throw new Error(`Secret ${this.secretArn} is not valid JSON`);
        }
    }

    async getPrivateKeyPem(): Promise<string> {
        const secrets = await this.parseSecrets();
        if (!secrets.github_private_key) {
            throw new Error(`Secret ${this.secretArn} does not contain github_private_key`);
        }
        return secrets.github_private_key;
    }

    async getOpenAiApiKey(): Promise<string> {
        const secrets = await this.parseSecrets();
        if (!secrets.openai_api_key) {
            throw new Error(`Secret ${this.secretArn} does not contain openai_api_key`);
        }
        return secrets.openai_api_key;
    }
}
