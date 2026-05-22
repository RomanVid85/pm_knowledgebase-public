import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

export default async function Home() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  // Use admin client for table reads (supabase-js typing is cleaner than ssr's).
  const admin = adminClient();
  const { data: profile } = user
    ? await admin
        .from("users")
        .select("role,display_name")
        .eq("id", user.id)
        .single()
    : { data: null };

  const role = profile?.role ?? "viewer";
  const canUpload = ["admin", "pm", "sme"].includes(role);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">PM Knowledge Base</h1>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user?.email} · {role}
        </span>
      </header>

      <p className="text-sm text-gray-600">
        Phase 2 in progress: ingestion pipeline. Upload an artifact below to run the
        parse → chunk → embed → persist pipeline against it. Topic pages, rule extraction,
        and MCP land in later phases.
      </p>

      <nav className="flex flex-col gap-2">
        {canUpload && (
          <Link
            href="/upload"
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Upload an artifact →
          </Link>
        )}
      </nav>

      <form action="/auth/signout" method="post" className="mt-auto">
        <button
          type="submit"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
