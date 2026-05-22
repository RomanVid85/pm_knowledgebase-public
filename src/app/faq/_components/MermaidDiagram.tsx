"use client";

// Mermaid renderer for FAQ workflow diagrams.
//
// Mermaid is heavy (~150KB) — we dynamically import it inside useEffect so
// the rest of the app doesn't pay for it. Each diagram gets a stable random
// id to avoid collisions when multiple diagrams render on the same page.

import { useEffect, useId, useRef, useState } from "react";

interface MermaidDiagramProps {
  /** Mermaid source — e.g. `flowchart TD\n  A --> B`. */
  source: string;
  /** Optional accessible description for screen readers. */
  ariaLabel?: string;
}

export function MermaidDiagram({
  source,
  ariaLabel,
}: MermaidDiagramProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  // Mermaid requires DOM ids that match CSS-identifier rules — strip the
  // colons useId() injects.
  const diagramId = `mermaid-${reactId.replace(/:/g, "")}`;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
          },
        });
        const { svg } = await mermaid.render(diagramId, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, diagramId]);

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        Failed to render diagram: {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel ?? "Workflow diagram"}
      className="overflow-x-auto rounded border border-gray-200 bg-white p-4"
    />
  );
}
