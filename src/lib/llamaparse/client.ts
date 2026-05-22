// LlamaParse v2 client (Auto Mode, polling pattern).
//
// Per the Phase 3 design decision (see DECISIONS.md 2026-05-15): we use
// polling rather than webhooks. Trades a tiny amount of efficiency for
// drastically simpler local-dev + Inngest integration — `step.run()` can
// hold a 1-3 minute poll loop natively without needing a public URL or a
// webhook handler route.
//
// API surface:
//   - submitJob(buf, filename) → jobId
//   - getJobStatus(jobId) → "PENDING" | "SUCCESS" | "ERROR" | "CANCELED"
//   - pollJob(jobId, opts) → resolves on SUCCESS, throws on ERROR/CANCELED/timeout
//   - getResultMarkdown(jobId) → fetches the markdown result
//   - parsePdfToMarkdown(buf, filename) — convenience wrapper around all four
//
// Native fetch (no llama-cloud-services SDK) for the same reason the Voyage
// client uses fetch: the SDK's public surface drifts ahead of our pinned
// version and we want full control of error handling. The REST API is
// stable.

import { getServerEnv } from "@/lib/env";

const BASE = "https://api.cloud.llamaindex.ai";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000; // 10 min — LlamaParse Auto Mode typically 30-120s

export type LlamaParseStatus = "PENDING" | "SUCCESS" | "ERROR" | "CANCELED";

export class LlamaParseRetriableError extends Error {
  override readonly name = "LlamaParseRetriableError";
}

export class LlamaParseFatalError extends Error {
  override readonly name = "LlamaParseFatalError";
}

function authHeaders(): Record<string, string> {
  const env = getServerEnv();
  return { Authorization: `Bearer ${env.LLAMAPARSE_API_KEY}` };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable>";
  }
}

/**
 * Submit a file (PDF or other supported format) for parsing. Returns the
 * job_id for polling. Uses parse_mode=auto for cost-effective parsing that
 * auto-upgrades to premium on pages with tables / images.
 */
export async function submitJob(file: Buffer, filename: string): Promise<string> {
  const fd = new FormData();
  // Browser-style FormData with a Blob: Node 18+ + fetch handles this fine.
  fd.append("file", new Blob([new Uint8Array(file)]), filename);
  // No explicit parse_mode — let LlamaParse use account-level defaults
  // (Auto Mode if configured in the account, otherwise Fast). Keeps the
  // request free-tier-friendly and avoids drift if LlamaParse renames
  // parse_mode values.

  const res = await fetch(`${BASE}/api/v1/parsing/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });

  if (res.status === 429 || res.status >= 500) {
    throw new LlamaParseRetriableError(`submit ${res.status}: ${await safeReadText(res)}`);
  }
  if (!res.ok) {
    throw new LlamaParseFatalError(`submit ${res.status}: ${await safeReadText(res)}`);
  }

  const json = (await res.json()) as { id?: string };
  if (typeof json.id !== "string" || json.id.length === 0) {
    throw new LlamaParseFatalError("submit returned no job id");
  }
  return json.id;
}

/** Single-shot status check. */
export async function getJobStatus(jobId: string): Promise<LlamaParseStatus> {
  const res = await fetch(`${BASE}/api/v1/parsing/job/${jobId}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (res.status === 429 || res.status >= 500) {
    throw new LlamaParseRetriableError(`status ${res.status}`);
  }
  if (!res.ok) {
    throw new LlamaParseFatalError(`status ${res.status}: ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as { status?: string };
  if (typeof json.status !== "string") {
    throw new LlamaParseFatalError("status response missing 'status' field");
  }
  const s = json.status.toUpperCase();
  if (s !== "PENDING" && s !== "SUCCESS" && s !== "ERROR" && s !== "CANCELED") {
    throw new LlamaParseFatalError(`unknown LlamaParse status: ${json.status}`);
  }
  return s as LlamaParseStatus;
}

export interface PollOptions {
  /** Interval between status checks. Default 3s. */
  intervalMs?: number;
  /** Maximum total wait. Default 10 min. Throws RetriableError on timeout. */
  timeoutMs?: number;
}

/**
 * Poll a job until it reaches a terminal state. Resolves on SUCCESS.
 * Throws on ERROR / CANCELED. Throws RetriableError if timeoutMs elapses
 * (lets Inngest retry the step).
 */
export async function pollJob(jobId: string, options: PollOptions = {}): Promise<void> {
  const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const status = await getJobStatus(jobId);
    if (status === "SUCCESS") return;
    if (status === "ERROR") {
      throw new LlamaParseFatalError(`job ${jobId} reached ERROR state`);
    }
    if (status === "CANCELED") {
      throw new LlamaParseFatalError(`job ${jobId} reached CANCELED state`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new LlamaParseRetriableError(`job ${jobId} polling exceeded timeout`);
}

/** Fetch the markdown result for a SUCCESS job. */
export async function getResultMarkdown(jobId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/parsing/job/${jobId}/result/markdown`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (res.status === 429 || res.status >= 500) {
    throw new LlamaParseRetriableError(`result ${res.status}`);
  }
  if (!res.ok) {
    throw new LlamaParseFatalError(`result ${res.status}: ${await safeReadText(res)}`);
  }
  const json = (await res.json()) as { markdown?: string };
  if (typeof json.markdown !== "string") {
    throw new LlamaParseFatalError("result response missing 'markdown' field");
  }
  return json.markdown;
}

/**
 * Convenience wrapper: submit → poll → fetch markdown. Use this from the
 * Inngest step when no fine-grained progress reporting is needed.
 */
export async function parsePdfToMarkdown(
  file: Buffer,
  filename: string,
  options: PollOptions = {},
): Promise<{ jobId: string; markdown: string }> {
  const jobId = await submitJob(file, filename);
  await pollJob(jobId, options);
  const markdown = await getResultMarkdown(jobId);
  return { jobId, markdown };
}
