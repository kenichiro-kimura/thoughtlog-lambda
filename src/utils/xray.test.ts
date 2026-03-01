import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubsegment, mockSegment } = vi.hoisted(() => {
    const mockSubsegment = {
        close: vi.fn(),
        addError: vi.fn(),
    };
    const mockSegment = {
        addNewSubsegment: vi.fn().mockReturnValue(mockSubsegment),
    };
    return { mockSubsegment, mockSegment };
});

// Mock aws-xray-sdk-core before importing the module under test
vi.mock("aws-xray-sdk-core", () => ({
    setContextMissingStrategy: vi.fn(),
    captureAWSv3Client: vi.fn((client: object) => client),
    resolveSegment: vi.fn().mockReturnValue(mockSegment),
    Subsegment: class {},
}));

import { captureAWSv3Client as xrayCaptureAWSv3Client, resolveSegment } from "aws-xray-sdk-core";
import { captureAWSv3Client, withSubsegment } from "./xray";

beforeEach(() => {
    vi.clearAllMocks();
    mockSegment.addNewSubsegment.mockReturnValue(mockSubsegment);
    (resolveSegment as ReturnType<typeof vi.fn>).mockReturnValue(mockSegment);
});

describe("captureAWSv3Client", () => {
    it("returns the same client object", () => {
        const client = { send: vi.fn() };
        const result = captureAWSv3Client(client);
        expect(result).toBe(client);
    });

    it("delegates to the X-Ray captureAWSv3Client", () => {
        const client = { send: vi.fn() };
        captureAWSv3Client(client);
        expect(xrayCaptureAWSv3Client).toHaveBeenCalledWith(client);
    });
});

describe("withSubsegment", () => {
    it("executes the function and returns its result", async () => {
        const result = await withSubsegment("test", async () => 42);
        expect(result).toBe(42);
    });

    it("closes the subsegment on success", async () => {
        await withSubsegment("test", async () => "ok");
        expect(mockSubsegment.close).toHaveBeenCalledOnce();
    });

    it("adds an error and closes the subsegment when the function throws", async () => {
        const error = new Error("boom");
        await expect(withSubsegment("test", async () => { throw error; })).rejects.toThrow("boom");
        expect(mockSubsegment.addError).toHaveBeenCalledWith(error);
        expect(mockSubsegment.close).toHaveBeenCalledOnce();
    });

    it("still calls the function when resolveSegment returns undefined", async () => {
        (resolveSegment as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
        const fn = vi.fn().mockResolvedValue("result");
        const result = await withSubsegment("test", fn);
        expect(fn).toHaveBeenCalledOnce();
        expect(result).toBe("result");
    });

    it("still calls the function when resolveSegment throws", async () => {
        (resolveSegment as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("no context"); });
        const fn = vi.fn().mockResolvedValue("result");
        const result = await withSubsegment("test", fn);
        expect(fn).toHaveBeenCalledOnce();
        expect(result).toBe("result");
    });
});
