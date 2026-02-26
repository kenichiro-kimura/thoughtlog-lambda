export interface ISecretProvider {
    getPrivateKeyPem(): Promise<string>;
}
