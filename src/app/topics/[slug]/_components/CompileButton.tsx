"use client";

// Compile button — wraps a form that posts to the compileTopicAction server
// action. Lives in a client component so we can intercept submit with a
// native confirm() when a draft is already pending review, preventing
// accidental stacking of v2/v3/v4 drafts.

import { compileTopicAction } from "../actions";

interface CompileButtonProps {
  slug: string;
  hasActivePage: boolean;
  pendingDraftVersion: number | null;
  disabled: boolean;
}

export function CompileButton({
  slug,
  hasActivePage,
  pendingDraftVersion,
  disabled,
}: CompileButtonProps): React.JSX.Element {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    if (pendingDraftVersion !== null) {
      const nextVersion = pendingDraftVersion + 1;
      const ok = window.confirm(
        `A v${pendingDraftVersion} draft is awaiting review. Compiling again creates v${nextVersion} alongside it (v${pendingDraftVersion} won't be deleted). Continue?`,
      );
      if (!ok) e.preventDefault();
    }
  };

  return (
    <form action={compileTopicAction} onSubmit={handleSubmit}>
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={disabled}
      >
        {hasActivePage ? "Recompile" : "Compile this topic"}
      </button>
    </form>
  );
}
