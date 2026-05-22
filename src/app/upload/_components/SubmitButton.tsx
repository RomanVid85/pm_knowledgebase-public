"use client";

// Submit button for any Server Action form. Disables itself while the
// form action is in-flight (between click and the eventual redirect) so
// a second click can't kick off a duplicate run. The orphan `102f5cc4`
// artifact that needed manual cleanup on Cloud was caused by exactly
// this race — two near-simultaneous uploads of the same file, two
// seconds apart.
//
// useFormStatus() is provided by react-dom for Server Action forms and
// reports `pending=true` while the action is awaiting completion.

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  /** Label when idle. Default "Upload & ingest" for the upload form. */
  label?: string;
  /** Label while the action is pending. Default "Uploading…". */
  pendingLabel?: string;
}

export function SubmitButton({
  label = "Upload & ingest",
  pendingLabel = "Uploading…",
}: SubmitButtonProps = {}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="self-start rounded bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
