"use client";

// Token display + copy controls for the MCP setup page.
//
// The access token + endpoint are passed in from the server. The "Copy"
// buttons use navigator.clipboard; degradation when unavailable shows a
// fallback "select all" textarea hint.

import { useState } from "react";

interface Props {
  accessToken: string;
  mcpEndpoint: string;
  expiresAt: number | null;
}

function expiryLabel(expiresAt: number | null): string {
  if (!expiresAt) return "expiry unknown";
  const now = Math.floor(Date.now() / 1000);
  const seconds = expiresAt - now;
  if (seconds <= 0) return "expired — refresh this page";
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return `expires in ${seconds}s`;
  if (mins < 60) return `expires in ~${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `expires in ~${hrs}h${rem ? ` ${rem}m` : ""}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore — fallback: user can select-and-copy from the field
        }
      }}
      className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
    >
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
}

export function McpTokenPanel({ accessToken, mcpEndpoint, expiresAt }: Props) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">MCP endpoint</span>
          <CopyButton value={mcpEndpoint} label="URL" />
        </div>
        <input
          type="text"
          readOnly
          value={mcpEndpoint}
          className="w-full rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">
            Bearer token{" "}
            <span className="text-gray-500">({expiryLabel(expiresAt)})</span>
          </span>
          <CopyButton value={accessToken} label="token" />
        </div>
        <textarea
          readOnly
          value={accessToken}
          rows={4}
          className="w-full rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
      </div>
    </div>
  );
}
