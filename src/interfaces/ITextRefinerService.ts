export interface ITextRefinerService {
    refine(text: string): Promise<string>;
}
