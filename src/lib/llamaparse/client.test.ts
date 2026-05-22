import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTesting } from "@/lib/env";
import {
  submitJob,
  getJobStatus,
  pollJob,
  getResultMarkdown,
  parsePdfToMarkdown,
  LlamaParseFatalError,
  LlamaParseRetriableError,
} from "./client";

const ORIGINAL_FETCH = global.fetch;

function mockOnce(status: number, body: unknown) {
  global.fetch = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1]!;
    i++;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.VOYAGE_API_KEY = "voyage-test";
  process.env.ANTHROPIC_API_KEY = "ant-test";
  process.env.LLAMAPARSE_API_KEY = "llx-test";
  resetEnvCacheForTesting();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("submitJob", () => {
  it("returns the job id on success", async () => {
    mockOnce(200, { id: "job-abc-123" });
    const jobId = await submitJob(Buffer.from("pdf-bytes"), "test.pdf");
    expect(jobId).toBe("job-abc-123");
  });

  it("throws RetriableError on 429", async () => {
    mockOnce(429, "rate limited");
    await expect(submitJob(Buffer.from(""), "x.pdf")).rejects.toBeInstanceOf(
      LlamaParseRetriableError,
    );
  });

  it("throws RetriableError on 5xx", async () => {
    mockOnce(503, "down");
    await expect(submitJob(Buffer.from(""), "x.pdf")).rejects.toBeInstanceOf(
      LlamaParseRetriableError,
    );
  });

  it("throws FatalError on 4xx that isn't 429", async () => {
    mockOnce(400, "bad input");
    await expect(submitJob(Buffer.from(""), "x.pdf")).rejects.toBeInstanceOf(
      LlamaParseFatalError,
    );
  });

  it("throws FatalError when response has no id", async () => {
    mockOnce(200, { not_an_id: true });
    await expect(submitJob(Buffer.from(""), "x.pdf")).rejects.toBeInstanceOf(
      LlamaParseFatalError,
    );
  });
});

describe("getJobStatus", () => {
  it("returns the status when valid", async () => {
    mockOnce(200, { status: "PENDING" });
    expect(await getJobStatus("job-1")).toBe("PENDING");
  });

  it("uppercases lowercase status from the API", async () => {
    mockOnce(200, { status: "success" });
    expect(await getJobStatus("job-1")).toBe("SUCCESS");
  });

  it("throws on unknown status value", async () => {
    mockOnce(200, { status: "PROCESSING_WEIRD" });
    await expect(getJobStatus("job-1")).rejects.toBeInstanceOf(LlamaParseFatalError);
  });

  it("throws RetriableError on 5xx", async () => {
    mockOnce(502, "");
    await expect(getJobStatus("job-1")).rejects.toBeInstanceOf(LlamaParseRetriableError);
  });
});

describe("pollJob", () => {
  it("returns immediately on SUCCESS", async () => {
    mockOnce(200, { status: "SUCCESS" });
    await expect(pollJob("job-1", { intervalMs: 1 })).resolves.toBeUndefined();
  });

  it("polls until SUCCESS", async () => {
    mockSequence([
      { status: 200, body: { status: "PENDING" } },
      { status: 200, body: { status: "PENDING" } },
      { status: 200, body: { status: "SUCCESS" } },
    ]);
    await expect(pollJob("job-1", { intervalMs: 1 })).resolves.toBeUndefined();
  });

  it("throws FatalError on ERROR", async () => {
    mockOnce(200, { status: "ERROR" });
    await expect(pollJob("job-1", { intervalMs: 1 })).rejects.toBeInstanceOf(LlamaParseFatalError);
  });

  it("throws FatalError on CANCELED", async () => {
    mockOnce(200, { status: "CANCELED" });
    await expect(pollJob("job-1", { intervalMs: 1 })).rejects.toBeInstanceOf(LlamaParseFatalError);
  });

  it("throws RetriableError on timeout (always PENDING)", async () => {
    mockOnce(200, { status: "PENDING" });
    await expect(
      pollJob("job-1", { intervalMs: 5, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(LlamaParseRetriableError);
  });
});

describe("getResultMarkdown", () => {
  it("returns markdown on success", async () => {
    mockOnce(200, { markdown: "# Heading\n\nbody" });
    const md = await getResultMarkdown("job-1");
    expect(md).toBe("# Heading\n\nbody");
  });

  it("throws FatalError when markdown field missing", async () => {
    mockOnce(200, { not_markdown: true });
    await expect(getResultMarkdown("job-1")).rejects.toBeInstanceOf(LlamaParseFatalError);
  });

  it("throws RetriableError on 5xx", async () => {
    mockOnce(503, "");
    await expect(getResultMarkdown("job-1")).rejects.toBeInstanceOf(LlamaParseRetriableError);
  });
});

describe("parsePdfToMarkdown", () => {
  it("submits, polls, fetches result end-to-end", async () => {
    mockSequence([
      { status: 200, body: { id: "job-99" } }, // submit
      { status: 200, body: { status: "PENDING" } }, // poll #1
      { status: 200, body: { status: "SUCCESS" } }, // poll #2
      { status: 200, body: { markdown: "# Result\n\nparsed body" } }, // result
    ]);
    const result = await parsePdfToMarkdown(Buffer.from("pdf-bytes"), "doc.pdf", {
      intervalMs: 1,
    });
    expect(result.jobId).toBe("job-99");
    expect(result.markdown).toBe("# Result\n\nparsed body");
  });
});
