"use client";

// Client half of the sidebar — handles active-link highlighting via
// usePathname. Pure rendering; all data comes from the server-side
// Sidebar component above.
//
// Items are organized into labeled sections (Ingest / Review) so related
// surfaces sit visually together. Section dividers + small caps headers.

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  /** Optional badge value (number or short string). Hidden when null/undefined. */
  badge?: number | null;
  /** Only show this nav item when one of these roles is active. */
  visibleForRoles?: ReadonlyArray<string>;
}

interface NavSection {
  /** Optional uppercase label rendered above the section. Omit for the top, unlabeled group. */
  heading?: string;
  items: NavItem[];
}

interface SidebarClientProps {
  displayName: string;
  role: string;
  verifiableCount: number;
  publishableDraftCount: number;
}

export function SidebarClient({
  displayName,
  role,
  verifiableCount,
  publishableDraftCount,
}: SidebarClientProps) {
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      items: [{ href: "/", label: "Home" }],
    },
    {
      heading: "Ingest",
      items: [
        { href: "/upload", label: "Upload", visibleForRoles: ["admin", "sme", "pm"] },
        { href: "/new-entry", label: "Field note", visibleForRoles: ["admin", "sme", "pm"] },
        { href: "/topics", label: "Topics" },
      ],
    },
    {
      heading: "Review",
      items: [
        {
          href: "/topics?filter=drafts",
          label: "Topic drafts",
          badge: publishableDraftCount > 0 ? publishableDraftCount : null,
        },
        {
          href: "/verification",
          label: "Verify rules",
          badge: verifiableCount > 0 ? verifiableCount : null,
          visibleForRoles: ["admin", "sme", "pm"],
        },
      ],
    },
    {
      items: [
        { href: "/mcp-setup", label: "MCP Setup" },
        { href: "/faq", label: "FAQ" },
      ],
    },
  ];

  const isActive = (href: string) => {
    // Strip query string for active-state comparison — /topics?filter=my-drafts
    // should match the /topics route's active state when the user is there.
    const cleanHref = href.split("?")[0] ?? href;
    if (cleanHref === "/") return pathname === "/";
    return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-gray-200 bg-gray-50 p-4 md:flex md:flex-col">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-gray-900">PM Knowledge Base</h1>
        <p className="mt-1 text-xs text-gray-600">
          {displayName} · <code>{role}</code>
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-4 text-sm">
        {sections.map((section, sIdx) => {
          const visibleItems = section.items.filter(
            (it) => !it.visibleForRoles || it.visibleForRoles.includes(role),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.heading ?? `s${sIdx}`} className="flex flex-col gap-1">
              {section.heading && (
                <div className="px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {section.heading}
                </div>
              )}
              {visibleItems.map((it) => {
                const active = isActive(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`flex items-center justify-between rounded px-3 py-2 transition-colors ${
                      active
                        ? "bg-gray-900 text-white"
                        : "text-gray-800 hover:bg-gray-200"
                    }`}
                  >
                    <span>{it.label}</span>
                    {typeof it.badge === "number" && it.badge > 0 && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                          active ? "bg-white text-gray-900" : "bg-amber-200 text-amber-900"
                        }`}
                        aria-label={`${it.badge} items pending`}
                      >
                        {it.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <form action="/auth/signout" method="POST" className="mt-4 border-t border-gray-200 pt-4">
        <button
          type="submit"
          className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-200"
        >
          Sign out
        </button>
      </form>
    </aside>
  );
}
