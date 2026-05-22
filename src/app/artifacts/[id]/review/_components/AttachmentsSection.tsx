// Renders the attachments associated with a field-note artifact.
// Server Component — fetches signed Storage URLs at render time (short-
// lived, scoped per attachment) so the page can preview images and link
// to non-image files without leaking the private bucket's contents.

import { adminClient } from "@/lib/supabase/admin";

const SIGNED_URL_TTL_SECONDS = 3600; // 1h — plenty for a review session

interface Attachment {
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  artifactId: string;
  /** artifact.attachments — typed as Json on the row, narrow here. */
  attachments: unknown;
}

export async function AttachmentsSection({ artifactId, attachments }: Props) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  const rows = attachments as Attachment[];

  // Bulk-sign all attachment URLs. Failures (e.g., a stale storage_path)
  // are tolerated — that attachment just renders without a working link.
  const supabase = adminClient();
  const signed = await Promise.all(
    rows.map(async (a) => {
      try {
        const { data } = await supabase.storage
          .from("artifacts")
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL_SECONDS);
        return data?.signedUrl ?? null;
      } catch {
        return null;
      }
    }),
  );

  return (
    <section className="rounded border border-gray-200 p-4">
      <h2 className="text-sm font-medium text-gray-700">
        Attachments <span className="text-xs text-gray-500">({rows.length})</span>
      </h2>
      <p className="mt-1 text-xs text-gray-600">
        Evidence files attached to this field note — not parsed for content, preserved for audit.
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((a, i) => {
          const url = signed[i];
          return (
            <li
              key={`${artifactId}-${i}`}
              className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-2"
            >
              {isImage(a.mime_type) && url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={a.filename}
                    className="max-h-48 w-full rounded border border-gray-200 bg-white object-contain"
                  />
                </a>
              ) : (
                <div className="flex h-16 items-center justify-center rounded border border-gray-200 bg-white text-xs text-gray-500">
                  {a.mime_type || "binary"}
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-gray-800" title={a.filename}>
                  {a.filename}
                </span>
                <span className="shrink-0 text-gray-500">{formatSize(a.size_bytes)}</span>
              </div>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-700 hover:underline"
                >
                  Open
                </a>
              ) : (
                <span className="text-xs text-red-700">Link unavailable</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
