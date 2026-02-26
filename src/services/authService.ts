import { signJwtRS256, normalizePem } from "../utils/jwt";
import type { HttpClient } from "../utils/http";

export interface IAuthService {
    getInstallationToken(): Promise<string>;
}

/** GitHub App installation token provider. */
export class GitHubAuthService implements IAuthService {
    constructor(
        private readonly appId: string | undefined,
        private readonly installationId: string | undefined,
        private readonly privateKeyPemRaw: string | undefined,
        private readonly httpClient: HttpClient,
    ) {}

    async getInstallationToken(): Promise<string> {
        const privateKeyPem = normalizePem(this.privateKeyPemRaw);
        if (!this.appId || !this.installationId || !privateKeyPem) {
            throw new Error("Missing env: GITHUB_APP_ID / GITHUB_INSTALLATION_ID / GITHUB_PRIVATE_KEY_PEM");
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
