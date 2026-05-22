"use server";

// Server actions for /topics/[slug] — compile, publish, reject.
//
// Compile fires the topic-page/compile-requested Inngest event. The function
// is auth-gated: admin / pm / sme / topic-owner only (defense in depth on
// top of the RLS policy on topic_pages).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { inngest } from "@/inngest/client";

const COMPILE_ELIGIBLE_ROLES = ["admin", "pm", "sme"] as const;

export async function compileTopicAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  if (typeof slug !== "string" || slug.length === 0) {
    redirect(`/topics?error=missing-slug`);
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  // Authorize BEFORE fetching the topic (Cubic P2): the same redirect for
  // "topic not found" and "not allowed" so an unauthorized user can't probe
  // topic existence.
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const hasRole = (COMPILE_ELIGIBLE_ROLES as readonly string[]).includes(role);

  const { data: topic } = await admin
    .from("topics")
    .select("id, owner_user_id")
    .eq("slug", slug)
    .single();
  const isOwner = topic?.owner_user_id === user.id;

  if (!hasRole && !isOwner) {
    redirect(`/topics?error=forbidden`);
  }
  if (!topic) {
    redirect(`/topics?error=topic-not-found`);
  }

  try {
    await inngest.send({
      name: "topic-page/compile-requested",
      data: { topicId: topic.id, invokerUserId: user.id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    redirect(`/topics/${slug}?error=${encodeURIComponent(`compile-send-failed:${msg}`)}`);
  }

  revalidatePath(`/topics/${slug}`);
  redirect(`/topics/${slug}?compiling=1`);
}
