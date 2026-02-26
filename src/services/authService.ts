import { signJwtRS256, normalizePem } from "../utils/jwt";
import type { HttpClient } from "../utils/http";
import type { IAuthService } from "../interfaces/IAuthService";
import type { ISecretProvider } from "../interfaces/ISecretProvider";

export type { IAuthService };

/** GitHub App installation token provider. */
export class GitHubAuthService implements IAuthService {
    constructor(
        private readonly appId: string | undefined,
        private readonly installationId: string | undefined,
        private readonly secretProvider: ISecretProvider,
        private readonly httpClient: HttpClient,
    ) {}

    async getInstallationToken(): Promise<string> {
        if (!this.appId || !this.installationId) {
            throw new Error("Missing env: GITHUB_APP_ID / GITHUB_INSTALLATION_ID");
        }
        const privateKeyPem = normalizePem(await this.secretProvider.getPrivateKeyPem());
        if (!privateKeyPem) {
            throw new Error("Private key PEM retrieved from Secrets Manager is empty or invalid");
        }

        const now = Math.floor(Date.now() / 1000);
        const jwt = signJwtRS256(
            { iat: now - 30, exp: now + 8 * 60, iss: Number(this.appId) },
            privateKeyPem,
        );

        const tokenResp = await this.httpClient(
            `https://api.github.com/app/installations/${this.installationId}/access_tokens`,
            { method: "POST", token: jwt },
        ) as { token: string };

        return tokenResp.token;
    }
}
