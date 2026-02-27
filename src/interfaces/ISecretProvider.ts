export interface ISecretProvider {
    getPrivateKeyPem(): Promise<string>;
    getOpenAiApiKey(): Promise<string>;
}
