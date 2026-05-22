import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnvCacheForTesting } from "@/lib/env";
import {
  embedDocuments,
  embedQuery,
  VoyageFatalError,
  VoyageRetriableError,
} from "./client";

const ORIGINAL_FETCH = global.fetch;

function mockOk(body: unknown) {
  global.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function mockStatus(status: number, body = "{}") {
  global.fetch = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function makeEmbedding(dim: number, fillValue = 0.1): number[] {
  return Array.from({ length: dim }, () => fillValue);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.VOYAGE_API_KEY = "test-voyage-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.LLAMAPARSE_API_KEY = "test-llamaparse-key";
  resetEnvCacheForTesting();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("voyage client — embedQuery", () => {
  it("returns a 1024-dim vector for a valid response", async () => {
    mockOk({
      data: [{ embedding: makeEmbedding(1024), index: 0 }],
      usage: { total_tokens: 4 },
    });
    const v = await embedQuery("hello");
    expect(v).toHaveLength(1024);
  });

  it("throws VoyageFatalError when API returns wrong dimension", async () => {
    mockOk({
      data: [{ embedding: makeEmbedding(512), index: 0 }],
    });
    await expect(embedQuery("hello")).rejects.toThrow(VoyageFatalError);
  });

  it("throws VoyageRetriableError on HTTP 429", async () => {
    mockStatus(429);
    await expect(embedQuery("hello")).rejects.toThrow(VoyageRetriableError);
  });

  it("throws VoyageRetriableError on HTTP 500", async () => {
    mockStatus(500);
    await expect(embedQuery("hello")).rejects.toThrow(VoyageRetriableError);
  });

  it("throws VoyageFatalError on HTTP 401", async () => {
    mockStatus(401);
    await expect(embedQuery("hello")).rejects.toThrow(VoyageFatalError);
  });
});

describe("voyage client — embedDocuments", () => {
  it("returns embeddings in input order even when API returns out-of-order indexes", async () => {
    // Voyage returns the second item first.
    mockOk({
      data: [
        { embedding: makeEmbedding(1024, 0.2), index: 1 },
        { embedding: makeEmbedding(1024, 0.1), index: 0 },
      ],
    });
    const [first, second] = await embedDocuments(["a", "b"]);
    expect(first?.[0]).toBe(0.1); // index 0 = "a"
    expect(second?.[0]).toBe(0.2); // index 1 = "b"
  });

  it("returns [] for empty input without calling fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await embedDocuments([]);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends model=voyage-4-large, output_dimension=1024, input_type=document", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ data: [{ embedding: makeEmbedding(1024), index: 0 }] }),
        { status: 200 },
      );
    });
    await embedDocuments(["hello"]);
    expect(capturedBody).toMatchObject({
      input: ["hello"],
      model: "voyage-4-large",
      output_dimension: 1024,
      input_type: "document",
    });
  });
});
