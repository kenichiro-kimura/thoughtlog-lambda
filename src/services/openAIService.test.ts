import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAITextRefinerService } from "./openAIService";
import type { ISecretProvider } from "../interfaces/ISecretProvider";

const API_KEY = "sk-test-key";

function makeSecretProvider(apiKey = API_KEY): ISecretProvider {
    return {
        getPrivateKeyPem: vi.fn().mockResolvedValue("pem"),
        getOpenAiApiKey: vi.fn().mockResolvedValue(apiKey),
    };
}

describe("OpenAITextRefinerService", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        mockFetch.mockClear();
    });

    it("returns refined text from OpenAI response", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                choices: [{ message: { content: "refined text" } }],
            }),
        });

        const provider = makeSecretProvider();
        const service = new OpenAITextRefinerService(provider, "gpt-4o-mini", "clean up the text", mockFetch as typeof fetch);
        const result = await service.refine("raw voice input");

        expect(result).toBe("refined text");
        expect(provider.getOpenAiApiKey).toHaveBeenCalledOnce();
    });

    it("sends correct request to OpenAI API", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                choices: [{ message: { content: "result" } }],
            }),
        });

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "system prompt", mockFetch as typeof fetch);
        await service.refine("user input");

        expect(mockFetch).toHaveBeenCalledWith(
            "https://api.openai.com/v1/chat/completions",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "Authorization": `Bearer ${API_KEY}`,
                    "Content-Type": "application/json",
                }),
            }),
        );

        const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
        expect(callBody.model).toBe("gpt-4o-mini");
        expect(callBody.messages).toEqual([
            { role: "system", content: "system prompt" },
            { role: "user", content: "user input" },
        ]);
    });

    it("throws when OpenAI API returns non-ok response", async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
        });

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockFetch as typeof fetch);
        await expect(service.refine("text")).rejects.toThrow("OpenAI API error: 429 Too Many Requests");
    });

    it("wraps AbortError as timeout error with original cause", async () => {
        const abortError = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
        mockFetch.mockRejectedValue(abortError);

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockFetch as typeof fetch);
        const rejection = await service.refine("text").catch((e: unknown) => e);
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toMatch(/timed out/);
        expect((rejection as Error).cause).toBe(abortError);
    });

    it("throws when OpenAI API returns empty content", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ choices: [] }),
        });

        const service = new OpenAITextRefinerService(makeSecretProvider(), "gpt-4o-mini", "prompt", mockFetch as typeof fetch);
        await expect(service.refine("text")).rejects.toThrow("OpenAI API returned no choices");
    });

    it("uses default model and prompt when not specified", async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                choices: [{ message: { content: "result" } }],
            }),
        });

        const service = new OpenAITextRefinerService(makeSecretProvider(), undefined, undefined, mockFetch as typeof fetch);
        await service.refine("text");

        const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
        expect(callBody.model).toBe("gpt-4o-mini");
        expect(callBody.messages[0].role).toBe("system");
    });
});
