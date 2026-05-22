import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock @anthropic-ai/sdk's default export (the Anthropic class) before
// importing the client. Each test installs its own behavior on
// `messagesCreate` via the returned mock.
const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: messagesCreate };
    },
  };
});

// Stub env so getServerEnv() doesn't try to read process.env at import time.
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.VOYAGE_API_KEY = "voyage-test";
  process.env.ANTHROPIC_API_KEY = "ant-test";
  process.env.LLAMAPARSE_API_KEY = "llamaparse-test";
  vi.resetModules();
  messagesCreate.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

const TestSchema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(1),
});

describe("callTool", () => {
  it("sends a tool-use request with the converted JSON schema and the user prompt", async () => {
    messagesCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "extract_test",
          input: { summary: "hello", score: 0.9 },
        },
      ],
    });

    const { callTool } = await import("./client");
    const result = await callTool({
      toolName: "extract_test",
      toolDescription: "Return a test result.",
      outputSchema: TestSchema,
      userPrompt: "Tell me about it.",
    });

    expect(result).toEqual({ summary: "hello", score: 0.9 });

    expect(messagesCreate).toHaveBeenCalledTimes(1);
    const call = messagesCreate.mock.calls[0]![0];
    expect(call.model).toBe("claude-opus-4-7");
    expect(call.tool_choice).toEqual({ type: "tool", name: "extract_test" });
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0]!.name).toBe("extract_test");
    expect(call.tools[0]!.input_schema).toBeDefined();
    expect(call.tools[0]!.input_schema.type).toBe("object");
    expect(call.messages).toEqual([{ role: "user", content: "Tell me about it." }]);
  });

  it("passes through systemPrompt and custom maxTokens", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "extract_test", input: { summary: "x", score: 0.5 } }],
    });

    const { callTool } = await import("./client");
    await callTool({
      toolName: "extract_test",
      toolDescription: "Return a test result.",
      outputSchema: TestSchema,
      systemPrompt: "You are precise.",
      userPrompt: "Hi.",
      maxTokens: 2048,
    });

    const call = messagesCreate.mock.calls[0]![0];
    expect(call.system).toBe("You are precise.");
    expect(call.max_tokens).toBe(2048);
  });

  it("throws ClaudeFatalError when the response contains no tool_use block", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "no tool used" }],
    });

    const { callTool, ClaudeFatalError } = await import("./client");
    await expect(
      callTool({
        toolName: "extract_test",
        toolDescription: "Return a test result.",
        outputSchema: TestSchema,
        userPrompt: "Hi.",
      }),
    ).rejects.toBeInstanceOf(ClaudeFatalError);
  });

  it("throws ClaudeFatalError when the tool_use input fails Zod validation", async () => {
    messagesCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "extract_test",
          input: { summary: 42, score: "not-a-number" },
        },
      ],
    });

    const { callTool, ClaudeFatalError } = await import("./client");
    await expect(
      callTool({
        toolName: "extract_test",
        toolDescription: "Return a test result.",
        outputSchema: TestSchema,
        userPrompt: "Hi.",
      }),
    ).rejects.toBeInstanceOf(ClaudeFatalError);
  });

  it("throws ClaudeRetriableError on 429 rate-limit errors", async () => {
    const err: { status: number; message: string } = {
      status: 429,
      message: "rate limited",
    };
    messagesCreate.mockRejectedValue(err);

    const { callTool, ClaudeRetriableError } = await import("./client");
    await expect(
      callTool({
        toolName: "extract_test",
        toolDescription: "Return a test result.",
        outputSchema: TestSchema,
        userPrompt: "Hi.",
      }),
    ).rejects.toBeInstanceOf(ClaudeRetriableError);
  });

  it("throws ClaudeRetriableError on 503 server errors", async () => {
    const err: { status: number; message: string } = {
      status: 503,
      message: "server overloaded",
    };
    messagesCreate.mockRejectedValue(err);

    const { callTool, ClaudeRetriableError } = await import("./client");
    await expect(
      callTool({
        toolName: "extract_test",
        toolDescription: "Return a test result.",
        outputSchema: TestSchema,
        userPrompt: "Hi.",
      }),
    ).rejects.toBeInstanceOf(ClaudeRetriableError);
  });

  it("throws ClaudeFatalError on 400-class errors that are not rate limits", async () => {
    const err: { status: number; message: string } = {
      status: 400,
      message: "bad request",
    };
    messagesCreate.mockRejectedValue(err);

    const { callTool, ClaudeFatalError } = await import("./client");
    await expect(
      callTool({
        toolName: "extract_test",
        toolDescription: "Return a test result.",
        outputSchema: TestSchema,
        userPrompt: "Hi.",
      }),
    ).rejects.toBeInstanceOf(ClaudeFatalError);
  });
});
