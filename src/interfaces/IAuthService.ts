export interface IAuthService {
    getInstallationToken(): Promise<string>;
}
