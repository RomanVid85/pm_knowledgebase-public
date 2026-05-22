// MCP setup page — gives a logged-in user everything they need to connect
// Claude Desktop / Cursor / any MCP client to the production knowledge base.
//
// Surfaces:
//   - The user's current Supabase access token (~1h expiry — flagged inline)
//   - The MCP endpoint URL (production)
//   - A ready-to-paste Claude Desktop config snippet with the token embedded
//   - A copy-to-clipboard control (Client Component handles the navigator API)
//
// The access token is in the user's session cookies already, so rendering
// it on this server-rendered, auth-gated page doesn't widen the exposure
// surface. Short expiry bounds risk on accidental copy/leak.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { McpTokenPanel } from "./_components/McpTokenPanel";

// Set this to your deployed production URL once you have one.
const PROD_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://your-deployment.example.com";

export default async function McpSetupPage() {
  const userClient = await createClient();
  const {
    data: { session },
  } = await userClient.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, display_name, email")
    .eq("id", user.id)
    .single();

  const accessToken = session?.access_token ?? "";
  const expiresAt = session?.expires_at ?? null;
  const mcpEndpoint = `${PROD_URL}/api/mcp`;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">MCP setup</h1>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user.email} · {profile?.role ?? "viewer"}
        </span>
      </header>

      <section className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-medium">What this is</p>
        <p className="mt-1">
          MCP (Model Context Protocol) lets your local AI tools — Claude Desktop, Cursor,
          Claude Code — query this knowledge base directly. Once configured, you can ask
          things like &ldquo;What are the verified rules for Acme lead management?&rdquo;
          and get back team-approved answers with citations.
        </p>
        <p className="mt-2 text-xs">
          You&apos;ll get access to three tools: <code>search_knowledge</code> (semantic
          search), <code>get_rules_for_topic</code> (verified rules only),{" "}
          <code>get_api_endpoint</code> (structured endpoint lookup).
        </p>
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Your access token</h2>
        <p className="mt-1 text-xs text-gray-600">
          Bearer token for the MCP endpoint. Expires roughly every hour — refresh this page
          and re-copy when it stops working. Treat like a password: don&apos;t commit it,
          don&apos;t share it.
        </p>
        <McpTokenPanel
          accessToken={accessToken}
          mcpEndpoint={mcpEndpoint}
          expiresAt={expiresAt ?? null}
        />
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Claude Desktop configuration</h2>
        <p className="mt-1 text-xs text-gray-600">
          On macOS, paste this into{" "}
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>. Restart
          Claude Desktop. The token is already filled in.
        </p>
        <ConfigSnippet endpoint={mcpEndpoint} token={accessToken} />
        <p className="mt-3 text-xs text-gray-500">
          For Cursor, the equivalent config goes in{" "}
          <code>~/.cursor/mcp.json</code> with the same shape. Other MCP clients support the
          same <code>mcp-remote</code> bridge pattern.
        </p>
      </section>

      <section className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-800">Test it</h2>
        <p className="mt-2">After restarting Claude Desktop, try this prompt:</p>
        <blockquote className="mt-2 rounded border border-gray-300 bg-white p-2 text-sm italic text-gray-800">
          Using the pm-knowledge-base MCP server, what are the verified rules for Acme
          lead management?
        </blockquote>
        <p className="mt-2 text-xs text-gray-500">
          Claude should call <code>get_rules_for_topic</code> with the appropriate slug from
          your taxonomy and return a list of structured rules.
        </p>
      </section>
    </div>
  );
}

function ConfigSnippet({ endpoint, token }: { endpoint: string; token: string }) {
  const config = {
    mcpServers: {
      "pm-knowledge-base": {
        command: "npx",
        args: ["-y", "mcp-remote@latest", endpoint, "--header", `Authorization: Bearer ${token}`],
      },
    },
  };
  return (
    <pre className="mt-3 overflow-auto rounded border border-gray-300 bg-gray-900 p-3 text-xs text-gray-100">
      {JSON.stringify(config, null, 2)}
    </pre>
  );
}
