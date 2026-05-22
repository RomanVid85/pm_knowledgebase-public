// Anthropic Claude client wrapper.
//
// Exposes a single function `callTool` that:
//   - Converts a caller-provided Zod schema into a JSON Schema tool definition.
//   - Sends a tool-use request to Claude (Opus 4.7) forcing the model to call
//     the tool with that schema as the input shape.
//   - Parses the tool_use response back through the Zod schema for runtime
//     validation.
//
// This is the pattern recommended by `agent_docs/coding_conventions.md`:
// "Structured outputs via JSON schema. Don't parse free-text. Claude API
//  supports tool use with Zod schemas for structured returns."
//
// Errors:
//   - ClaudeRetriableError on 429 / 5xx — Inngest retries with backoff.
//   - ClaudeFatalError on missing tool_use block, schema validation failure,
//     or 4xx (non-429). Inngest will not retry.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getServerEnv } from "@/lib/env";

const MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 4096;

export class ClaudeRetriableError extends Error {
  override readonly name = "ClaudeRetriableError";
}

export class ClaudeFatalError extends Error {
  override readonly name = "ClaudeFatalError";
}

let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  if (!cachedClient) {
    const env = getServerEnv();
    cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

export interface CallToolOptions<T> {
  /** Tool name passed to Claude; also used in tool_choice. */
  toolName: string;
  /** Tool description shown to Claude; should be a brief imperative sentence. */
  toolDescription: string;
  /** Zod schema describing the expected tool-use input shape. */
  outputSchema: z.ZodType<T>;
  /** Optional system prompt; useful for setting role / tone. */
  systemPrompt?: string;
  /** The user-turn prompt body. */
  userPrompt: string;
  /** Token cap for the response. Defaults to 4096. */
  maxTokens?: number;
}

function isHttpError(e: unknown): e is { status: number; message?: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

/**
 * Calls Claude with a tool definition derived from `outputSchema`, forces
 * the model to use the tool, and returns the parsed-and-validated tool input.
 */
export async function callTool<T>(opts: CallToolOptions<T>): Promise<T> {
  const client = getClient();
  const inputSchema = zodToJsonSchema(opts.outputSchema);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          // The Anthropic SDK's `input_schema` is typed against a narrow
          // JSON-Schema-7 subset; zod-to-json-schema returns the same shape
          // but the SDK doesn't know that.
          input_schema: inputSchema as unknown as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.userPrompt }],
    });
  } catch (e) {
    if (isHttpError(e)) {
      if (e.status === 429 || (e.status >= 500 && e.status < 600)) {
        throw new ClaudeRetriableError(`Claude ${e.status}: ${e.message ?? "unknown error"}`);
      }
      throw new ClaudeFatalError(`Claude ${e.status}: ${e.message ?? "unknown error"}`);
    }
    throw new ClaudeFatalError(`Claude call failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new ClaudeFatalError("Claude response contained no tool_use block");
  }

  const parsed = opts.outputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new ClaudeFatalError(
      `Claude tool_use input failed schema validation: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

/** Test-only: reset the cached SDK client (so a fresh ANTHROPIC_API_KEY is read). */
export function resetClaudeClientForTesting(): void {
  cachedClient = undefined;
}
