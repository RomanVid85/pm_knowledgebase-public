// Polls every 2s via router.refresh() until the server-side page sees
// topic_suggestions populated. After 60s without success, surfaces a
// "taking longer than expected" fallback with a link to the legacy
// manual-classification flow. Q3 resolution in DECISIONS.md 2026-05-12.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 60_000;

export function ReviewLoader({ artifactId }: { artifactId: string }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;
    const interval = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    const timeout = setTimeout(() => {
      setTimedOut(true);
      clearInterval(interval);
    }, TIMEOUT_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [router, timedOut]);

  if (timedOut) {
    return (
      <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
        <p className="font-medium">Taking longer than expected.</p>
        <p className="mt-1">
          The suggest-topics step has been running for over a minute.
          {process.env.NODE_ENV === "development" && (
            <>
              {" "}
              Locally, check the Inngest dashboard at{" "}
              <code>http://localhost:8288</code>.
            </>
          )}{" "}
          You can retry now, or fall back to the legacy manual-classification flow.
        </p>
        <p className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Retry now
          </button>
          <Link
            href="/upload"
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Back to upload
          </Link>
        </p>
        <p className="mt-2 text-xs text-yellow-800">
          Artifact id: <code>{artifactId}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
        <span>Polling for results…</span>
      </div>
      <p className="mt-2 text-xs text-blue-800">
        This page refreshes every 2 seconds. Artifact id: <code>{artifactId}</code>
      </p>
    </div>
  );
}
