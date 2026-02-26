import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { ISecretProvider } from "../interfaces/ISecretProvider";

export type { ISecretProvider };

/** Fetches a PEM-encoded private key from AWS Secrets Manager at runtime. */
export class SecretsManagerSecretProvider implements ISecretProvider {
    private readonly client: SecretsManagerClient;

    constructor(
        private readonly secretArn: string,
        client?: SecretsManagerClient,
    ) {
        this.client = client ?? new SecretsManagerClient({});
    }

    async getPrivateKeyPem(): Promise<string> {
        const resp = await this.client.send(
            new GetSecretValueCommand({ SecretId: this.secretArn }),
        );
        const value = resp.SecretString;
        if (!value) {
            throw new Error(`Secret ${this.secretArn} has no SecretString value`);
        }
        return value;
    }
}
