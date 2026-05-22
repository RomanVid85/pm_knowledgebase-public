// High-level compileTopicPage() — wraps the Claude callTool() with the
// compile_topic_page prompt + CompiledPageSchema. The Inngest function in
// src/inngest/functions/compile-topic-page.ts calls this between the
// gather-inputs and validate-citations steps.

import { callTool } from "@/lib/claude/client";
import {
  buildCompileTopicPagePrompt,
  type CompileTopicPagePromptInputs,
} from "@/lib/claude/prompts/compile_topic_page";
import { CompiledPageSchema, type CompiledPage } from "@/lib/compilation/schema";

const TOOL_NAME = "compile_topic_page";
const TOOL_DESCRIPTION =
  "Return the compiled topic page (summary + 7 sections, each with text and citations).";

export async function compileTopicPage(
  inputs: CompileTopicPagePromptInputs,
): Promise<CompiledPage> {
  const { systemPrompt, userPrompt } = buildCompileTopicPagePrompt(inputs);
  return callTool({
    toolName: TOOL_NAME,
    toolDescription: TOOL_DESCRIPTION,
    outputSchema: CompiledPageSchema,
    systemPrompt,
    userPrompt,
    // Compilation produces 7 sections with markdown + citations. Long output
    // expected; cap is generous to avoid mid-section truncation.
    maxTokens: 16384,
  });
}
