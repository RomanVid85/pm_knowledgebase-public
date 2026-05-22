// FAQ — concise, scannable answers to the things PMs (and engineers) ask
// when first using the knowledge base. Treat this as the in-app "how-to."
// Static content; lives in this page rather than the README because new
// users don't necessarily read READMEs.

import Link from "next/link";
import { MermaidDiagram } from "./_components/MermaidDiagram";

const FLOW_INGEST = `flowchart TD
  A(["/upload<br/>.docx · .md · .pdf"]):::userAction --> B["Inngest pipeline<br/>parse → chunk → embed<br/>suggest topics → persist"]:::system
  B --> C["/artifacts/[id]/review<br/>PM picks/edits topics<br/>+ supersession check"]:::userAction
  C --> D{"PM confirms?"}:::decision
  D -->|yes| E(["artifact.status='active'"]):::live
  D -->|no| F["stay draft<br/>(retry / cancel)"]:::state
  E --> G[["fires rule-extraction event"]]:::event

  classDef userAction fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef system fill:#f3f4f6,stroke:#6b7280,color:#1f2937
  classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef state fill:#f3f4f6,stroke:#9ca3af,color:#374151
  classDef live fill:#d1fae5,stroke:#10b981,color:#064e3b
  classDef event fill:#ede9fe,stroke:#7c3aed,color:#4c1d95`;

const FLOW_FIELDNOTE = `flowchart TD
  A(["/new-entry<br/>title · prose · attachments"]):::userAction --> B["Submit"]:::userAction
  B --> C["Synthesize .md from prose<br/>Upload attachments → Storage<br/>artifact_type='field_note'"]:::system
  C --> D["Same Inngest pipeline<br/>parse → chunk → embed → suggest"]:::system
  D --> E["/artifacts/[id]/review"]:::userAction
  E --> F{"PM confirms?"}:::decision
  F -->|yes| G(["artifact.status='active'"]):::live

  classDef userAction fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef system fill:#f3f4f6,stroke:#6b7280,color:#1f2937
  classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef live fill:#d1fae5,stroke:#10b981,color:#064e3b`;

const FLOW_RULES = `flowchart TD
  A(["Artifact confirmed"]):::userAction --> B["AI extracts rules<br/>(Inngest + Claude)"]:::system
  B --> C["status='pending_verification'"]:::state
  C --> D["/verification queue<br/>filtered:<br/>• not extractor<br/>• not AI invoker<br/>• not topic owner"]:::userAction
  D --> E{"Verifier decides?"}:::decision
  E -->|accept| F(["status='active'<br/>human_verified=true"]):::live
  E -->|reject| G["status='disputed'<br/>+ notes"]:::state
  F --> H[["MCP get_rules_for_topic"]]:::event

  classDef userAction fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef system fill:#f3f4f6,stroke:#6b7280,color:#1f2937
  classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef state fill:#f3f4f6,stroke:#9ca3af,color:#374151
  classDef live fill:#d1fae5,stroke:#10b981,color:#064e3b
  classDef event fill:#ede9fe,stroke:#7c3aed,color:#4c1d95`;

const FLOW_COMPILE = `flowchart TD
  A(["/topics/[slug]"]):::userAction --> B["Click 'Compile this topic'"]:::userAction
  B --> C["Inngest compile-topic-page"]:::system
  C --> D["Claude reads:<br/>• active verified rules<br/>• top ~20 chunks<br/>• active artifacts"]:::system
  D --> E["7-section page<br/>+ citation validation"]:::system
  E --> F["topic_pages.status='draft'"]:::state
  F --> G["/topics/[slug]/versions/[v]/review"]:::userAction
  G --> H{"Owner decides?"}:::decision
  H -->|publish| I(["status='active'<br/>prior → 'superseded'"]):::live
  H -->|reject| J["status='archived'<br/>+ reject notes"]:::state
  I --> K[["MCP get_topic_page"]]:::event

  classDef userAction fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef system fill:#f3f4f6,stroke:#6b7280,color:#1f2937
  classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef state fill:#f3f4f6,stroke:#9ca3af,color:#374151
  classDef live fill:#d1fae5,stroke:#10b981,color:#064e3b
  classDef event fill:#ede9fe,stroke:#7c3aed,color:#4c1d95`;

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

interface FaqSection {
  title: string;
  intro?: string;
  items: FaqItem[];
}

const SECTIONS: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "What is this knowledge base for?",
        a: (
          <>
            <p>
              A team context layer for PMs. Capture vendor docs, internal briefs, and analyst
              reports once; the system extracts structured rules + endpoints, lets you verify
              them, and exposes everything to AI assistants (Claude Desktop, Cursor, Claude
              Code) and to engineering agents via{" "}
              <Link href="/mcp-setup" className="text-blue-700 hover:underline">
                MCP
              </Link>
              .
            </p>
            <p className="mt-2">
              The system is vendor-agnostic — vendor APIs, internal specs, third-party
              reports, and internal notes all ingest through the same flow. Pick a pilot
              domain that fits your team and grow the taxonomy from there.
            </p>
          </>
        ),
      },
      {
        q: "How does content move through the system? (workflow diagrams)",
        a: (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-blue-500 bg-blue-100" />{" "}
                user action
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-gray-500 bg-gray-100" />{" "}
                system step
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-amber-600 bg-amber-100" />{" "}
                decision
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-emerald-500 bg-emerald-100" />{" "}
                live / active
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-violet-600 bg-violet-100" />{" "}
                event / MCP
              </span>
            </div>

            <div>
              <p className="mb-2 font-medium text-gray-900">
                1. Ingest an artifact (file upload)
              </p>
              <MermaidDiagram
                source={FLOW_INGEST}
                ariaLabel="Artifact upload workflow"
              />
            </div>

            <div>
              <p className="mb-2 font-medium text-gray-900">
                2. Capture a field note (informal evidence)
              </p>
              <MermaidDiagram
                source={FLOW_FIELDNOTE}
                ariaLabel="Field note capture workflow"
              />
            </div>

            <div>
              <p className="mb-2 font-medium text-gray-900">
                3. Extract + verify business rules
              </p>
              <MermaidDiagram
                source={FLOW_RULES}
                ariaLabel="Rule extraction and verification workflow"
              />
            </div>

            <div>
              <p className="mb-2 font-medium text-gray-900">
                4. Compile + publish a topic page
              </p>
              <MermaidDiagram
                source={FLOW_COMPILE}
                ariaLabel="Topic page compilation and publish workflow"
              />
            </div>

            <p className="text-xs text-gray-500">
              Notes: every step writes audit trail in <code>ingest_jobs</code> or the
              affected row&apos;s provenance columns. Inngest retries are idempotent at the
              step level. Owner-only publish is the V1 review rigor for topic pages; rules
              get the heavier two-person verification per{" "}
              <code>agent_docs/verification_workflow.md</code>.
            </p>
          </div>
        ),
      },
      {
        q: "Who can do what?",
        a: (
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <strong>Admin</strong> — everything (uploads, reviews, verifies, edits config).
            </li>
            <li>
              <strong>PM</strong> — uploads, reviews, verifies (subject to two-person rule).
            </li>
            <li>
              <strong>SME</strong> — verifies; usually the deepest domain knowledge.
            </li>
            <li>
              <strong>Engineer</strong> — read-only via MCP, no in-app actions.
            </li>
            <li>
              <strong>Viewer</strong> — read-only access to the UI, no uploads or verification.
            </li>
          </ul>
        ),
      },
    ],
  },
  {
    title: "Uploading content",
    items: [
      {
        q: "What formats can I upload?",
        a: (
          <p>
            Markdown (.md), Word (.docx), OpenAPI specs (.yaml / .yml / .json), and PDFs.
            PDFs go through LlamaParse, which can take 30 seconds to 2 minutes.
          </p>
        ),
      },
      {
        q: "When should I write a field note instead of uploading a file?",
        a: (
          <>
            <p>
              <strong>Upload</strong> a file when the file itself is the source of truth —
              published vendor docs, OpenAPI specs, structured training guides.
            </p>
            <p className="mt-2">
              <strong>Write a field note</strong> when the knowledge comes from an informal
              channel: a vendor engineer&apos;s email confirming an undocumented behavior, a
              Slack screenshot, a customer call summary, a verbal answer at a conference. You
              type the prose (that&apos;s what the system indexes); attach the
              screenshot/email/transcript as evidence (preserved for audit but not parsed).
            </p>
            <p className="mt-2">
              Rule of thumb: if you find yourself wanting to upload a screenshot, you almost
              certainly want a field note instead. OCR&apos;ing a screenshot loses the
              context you have in your head; a field note captures both your interpretation
              AND the receipt.
            </p>
          </>
        ),
      },
      {
        q: "How do I write a field note?",
        a: (
          <>
            <ol className="ml-5 list-decimal space-y-2 text-sm">
              <li>
                Click <strong>Field note</strong> in the left sidebar (visible to admin/sme/pm
                roles).
              </li>
              <li>
                <strong>Title</strong> — one sentence summarizing the claim. This becomes the
                artifact&apos;s title and shows up in search results.{" "}
                <em>e.g. &ldquo;Acme Showroom API supports CRM notes
                (undocumented).&rdquo;</em>
              </li>
              <li>
                <strong>Content</strong> — the actual knowledge, written by you in plain
                language. Cite who said it + when + what the claim is + caveats. Use markdown
                headings (<code>#</code>, <code>##</code>) to break long notes into sections;
                the system uses those for chunking. This text is what gets indexed and made
                searchable.
              </li>
              <li>
                <strong>Vendor + version</strong> — optional. If you leave blank, the system
                will try to infer them from your content. You can confirm or override on the
                review page.
              </li>
              <li>
                <strong>Source authority</strong> — pick the tier that matches the source.
                Most field notes are <code>vendor_reference</code> (vendor engineer&apos;s
                email or DM) or <code>internal_interpretive</code> (your team&apos;s
                conjecture from a call). When in doubt, tag lower.
              </li>
              <li>
                <strong>Attachments</strong> — optional. Drop the email screenshot, a Slack
                screenshot, a Loom recording, a PDF email export, etc. Up to ~25 MB per file,
                multiple files OK. Attachments are stored as evidence and surfaced on the
                artifact&apos;s review page, but their contents are NOT parsed or indexed
                — only your written prose is.
              </li>
              <li>
                Click <strong>Save field note</strong>. You&apos;ll land on the same review
                page that uploads use: topic suggestions, vendor classification, optional
                supersession card. Confirm to activate.
              </li>
              <li>
                After activation, the auto-rule-extraction step runs on your prose just like
                any other artifact. Resulting rules land in the verification queue for a
                second team member to approve before they become MCP-visible.
              </li>
            </ol>
            <p className="mt-3 text-xs text-gray-600">
              The full example for the showroom-API case lives in the textarea placeholder on
              the Field note page — it&apos;s a good template to copy from.
            </p>
          </>
        ),
      },
      {
        q: "What can I attach to a field note?",
        a: (
          <>
            <p>Common things teams attach:</p>
            <ul className="ml-5 list-disc space-y-1 text-sm">
              <li>
                <strong>Email screenshots / forwarded emails</strong> — most common. Catch
                the sender, date, and subject line in frame.
              </li>
              <li>
                <strong>Slack screenshots</strong> — when a vendor confirms in a shared
                channel.
              </li>
              <li>
                <strong>Loom / video recordings</strong> — vendor demos, customer call clips.
              </li>
              <li>
                <strong>PDF / DOCX exports</strong> — meeting agendas, NDA-bounded specs.
              </li>
              <li>
                <strong>Voice memos / call transcripts</strong> — when something was said
                verbally and you want the audio for receipt.
              </li>
            </ul>
            <p className="mt-2 text-xs text-gray-600">
              Accepted MIME types: images (any), PDF, DOCX, TXT, EML, MP4/MOV, MP3/M4A. Size
              cap: ~25 MB per attachment. If you have something larger, link to it in your
              content (Google Drive / SharePoint URL) and skip the attachment.
            </p>
          </>
        ),
      },
      {
        q: "What happens after I click Upload?",
        a: (
          <>
            <p>The system runs through these steps in the background:</p>
            <ol className="ml-5 mt-1 list-decimal space-y-1 text-sm">
              <li>Parse the file (extracting text + section structure)</li>
              <li>Chunk into semantic sections + embed each chunk</li>
              <li>Persist chunks to the database</li>
              <li>
                Run topic suggestion: scans content, proposes existing topic matches + new
                topics where the taxonomy has gaps
              </li>
              <li>
                Vendor + version inference: detects which vendor + version this document is
                about from filename, title, and content
              </li>
              <li>
                Supersession detection: checks if this is a newer version of an existing doc
              </li>
              <li>Drops you on the review page once suggestions are ready</li>
            </ol>
          </>
        ),
      },
      {
        q: "Why does the review page exist?",
        a: (
          <>
            <p>
              The system is &ldquo;LLM proposes, PM confirms.&rdquo; The AI&apos;s suggestions
              are good starting points — strong-confidence matches are pre-checked, slugs follow
              the naming convention, descriptions are written for retrieval — but the human is
              the source of truth on:
            </p>
            <ul className="ml-5 mt-1 list-disc space-y-1 text-sm">
              <li>Whether a proposed new topic should actually exist</li>
              <li>Whether the artifact belongs to the suggested topics or different ones</li>
              <li>What vendor + version it&apos;s really about</li>
              <li>Whether it&apos;s a re-upload of an existing doc (supersession)</li>
            </ul>
            <p className="mt-2">
              An artifact stays in <code>draft</code> until you confirm. Drafts aren&apos;t
              searchable. After confirmation, the artifact becomes <code>active</code> and the
              system kicks off rule extraction in the background.
            </p>
          </>
        ),
      },
      {
        q: "Why is the vendor classification required?",
        a: (
          <p>
            Because vendor drives <em>supersession detection</em> — the system can only
            recognize a re-upload of the same content if it knows both copies share a vendor.
            If your artifact isn&apos;t about a specific vendor (industry research, internal
            strategy, customer feedback), check &ldquo;Not vendor-specific.&rdquo; That tells
            the system the classification is intentional, not a forgotten field.
          </p>
        ),
      },
    ],
  },
  {
    title: "Topics & taxonomy",
    items: [
      {
        q: "What are topics, and where do they come from?",
        a: (
          <>
            <p>
              Topics are subject-matter domains — &ldquo;Lead Management API,&rdquo;
              &ldquo;Reporting &amp; Analytics,&rdquo; etc. They&apos;re how the system
              organizes content for retrieval.
            </p>
            <p className="mt-2">
              The seed has a few starter topics. New topics get created two ways:
            </p>
            <ul className="ml-5 mt-1 list-disc space-y-1 text-sm">
              <li>
                <strong>AI-proposed</strong> on the review page when you upload content that
                doesn&apos;t fit existing topics
              </li>
              <li>
                <strong>Manually added</strong> via the &ldquo;Add manual topic&rdquo; section
                of the review page
              </li>
            </ul>
            <p className="mt-2">
              Both paths require slug + name + description. The description is important — it
              gets embedded and drives future automatic matching.
            </p>
          </>
        ),
      },
      {
        q: "What's slug vs name vs description?",
        a: (
          <ul className="ml-5 list-disc space-y-1 text-sm">
            <li>
              <strong>slug</strong> — URL-safe identifier (<code>lead-management-api</code>).
              Stable. Other things reference it. Don&apos;t rename.
            </li>
            <li>
              <strong>name</strong> — human-readable display label
              (&ldquo;Lead Management API&rdquo;). Can be tuned.
            </li>
            <li>
              <strong>description</strong> — 1-2 sentence summary. Gets embedded; drives
              automatic topic matching for future uploads.
            </li>
          </ul>
        ),
      },
      {
        q: "Why did my upload only get one topic when I expected several?",
        a: (
          <p>
            Topic granularity is driven by the existing taxonomy. The AI tends to propose
            umbrella topics for brand-new vendor domains where there&apos;s no established
            per-API pattern. For vendors already in the taxonomy, it correctly matches
            into the specific topics. Workaround: add the per-API specific topics manually
            on the review page, then future uploads from that vendor will auto-match.
          </p>
        ),
      },
    ],
  },
  {
    title: "Verification",
    items: [
      {
        q: "What is the verification queue?",
        a: (
          <p>
            When an artifact goes <code>active</code>, the system kicks off{" "}
            <em>rule extraction</em> — the AI reads the content and pulls out structured
            business rules (required fields, allowed values, rate limits, deprecated behavior).
            Each rule lands in <code>pending_verification</code> until a different team member
            reviews and approves it. The{" "}
            <Link href="/verification" className="text-blue-700 hover:underline">
              verification queue
            </Link>{" "}
            is where this happens.
          </p>
        ),
      },
      {
        q: "What does the verifier check?",
        a: (
          <ul className="ml-5 list-disc space-y-1 text-sm">
            <li>
              Does the structured <code>value</code> faithfully match the <code>source_quote</code>?
            </li>
            <li>Is the rule actually true in practice (not just claimed in the doc)?</li>
            <li>
              Is the <code>rule_key</code> well-formed and at the right granularity?
            </li>
            <li>
              Do the conditions make sense (specific endpoint? specific version? specific
              role)?
            </li>
          </ul>
        ),
      },
      {
        q: "Why is the two-person rule so strict (admin can't override)?",
        a: (
          <p>
            Verified rules eventually get exposed to engineers via MCP as &ldquo;team-approved
            truth.&rdquo; A subtly wrong rule that gets verified would silently propagate. The
            two-person rule — verifier ≠ extractor, ≠ AI invoker, ≠ topic owner — is the
            mechanism that prevents this. Admin is a privilege role for things like editing
            config, but identity-based conflict checks apply to everyone equally. If you
            triggered the AI extraction, you can&apos;t also verify what the AI produced —
            even if you&apos;re admin.
          </p>
        ),
      },
      {
        q: "Why is my Verification badge showing 0 when I know rules are pending?",
        a: (
          <p>
            The badge counts rules <em>you</em> can verify, not total pending. If you
            triggered the AI extraction (uploaded + confirmed the artifact) OR own the topic
            the rule is on, you&apos;re blocked from verifying. Sign in as a different team
            member with no conflict to clear those rules.
          </p>
        ),
      },
    ],
  },
  {
    title: "Topic pages",
    intro:
      "Topic pages are AI-compiled syntheses of what the team knows about a topic — 7 sections (current view, why we believe it, what changed recently, open questions, contradictions, recommended next actions, source artifacts). They're working views, NOT the source of truth. Always refreshable, always cited.",
    items: [
      {
        q: "How do I compile a topic page?",
        a: (
          <>
            <p>
              Open the topic at <code>/topics/[slug]</code> (or via{" "}
              <Link href="/topics" className="text-blue-700 hover:underline">
                Topics
              </Link>{" "}
              in the sidebar). Click <strong>Compile this topic</strong>. An Inngest job
              runs (~30-60s) that reads the topic&apos;s active verified rules, top-ranked
              chunks, and tagged artifacts; Claude synthesizes the 7 sections; the result
              lands as a draft.
            </p>
            <p className="mt-2">
              Compilation is gated to admin, PM, SME, or the topic owner. A topic with no
              substrate (0 verified rules, 0 tagged artifacts) can&apos;t be compiled —
              ingest content first.
            </p>
          </>
        ),
      },
      {
        q: "Who can publish a draft?",
        a: (
          <p>
            <strong>Only the topic owner.</strong> Compiled pages are non-authoritative
            synthesis, not engineering guardrails like rules — so the heavier two-person
            verification doesn&apos;t apply. The trade-off: the owner is solely
            accountable for what gets published under their topic. Other admin/PM/SME
            users can <em>view</em> the draft (read-only) but won&apos;t see Publish or
            Reject buttons.
          </p>
        ),
      },
      {
        q: "What happens when I publish?",
        a: (
          <>
            <p>
              The draft transitions to <code>status=&apos;active&apos;</code>. Any prior
              active version for the same topic gets <code>status=&apos;superseded&apos;</code>{" "}
              with the supersedes chain updated. The new version is what shows on the topic
              page and what the MCP <code>get_topic_page</code> tool returns. Older
              versions stay queryable for audit but aren&apos;t served by default.
            </p>
            <p className="mt-2">
              Rejecting a draft sets it to <code>status=&apos;archived&apos;</code> with
              your notes preserved in metadata. The active version (if any) is untouched.
            </p>
          </>
        ),
      },
      {
        q: "Can I compile again if a draft is already pending?",
        a: (
          <p>
            Yes — the system supports stacking drafts (v2, v3, v4 can coexist in{" "}
            <code>status=&apos;draft&apos;</code>). The Compile button will pop a
            confirmation dialog so you don&apos;t do it by accident. Legitimate reasons
            to recompile while a draft exists: new substrate has landed (new artifacts
            ingested, new rules verified), or we shipped a prompt update and you want
            to see the new output. The owner picks which draft to publish.
          </p>
        ),
      },
      {
        q: "What are citation warnings?",
        a: (
          <p>
            Each compiled draft has <code>metadata.warnings</code>. These are citations
            Claude produced that didn&apos;t resolve against the live data — usually a
            hallucinated artifact_id, or a chunk attributed to the wrong artifact. The
            validator drops them before the draft saves; the draft still lands so the
            owner can decide whether to recompile. &gt;5 warnings on a draft is a signal
            to recompile rather than publish.
          </p>
        ),
      },
      {
        q: "Where do drafts I need to publish show up?",
        a: (
          <p>
            The <strong>Review → Topic drafts</strong> link in the sidebar shows
            drafts on topics you own, with a badge count. Click in, click a draft, review,
            publish or reject. Same surface other reviewers see read-only.
          </p>
        ),
      },
    ],
  },
  {
    title: "Authority & versioning",
    items: [
      {
        q: "What does source authority mean? Which tier should I pick?",
        a: (
          <>
            <p>
              Authority tier weights how much the system trusts the source during retrieval.
              Higher tier = ranks higher in search results for the same content.
            </p>
            <ul className="ml-5 mt-1 list-disc space-y-1 text-sm">
              <li>
                <strong>vendor_canonical</strong> (1.0) — official vendor docs (signed PDF,
                published API spec, vendor portal). Use for competitor docs too — just set
                the vendor field to their name.
              </li>
              <li>
                <strong>vendor_reference</strong> (0.85) — vendor-published but not primary
                (webinar, blog post, sample payload).
              </li>
              <li>
                <strong>external_authoritative</strong> (0.7) — respected third-party not
                vouched for by us (industry analyst reports, formal standards bodies).
              </li>
              <li>
                <strong>internal_canonical</strong> (0.75) — explicitly team-blessed (ADR,
                owned API spec, a report we adopted after review).
              </li>
              <li>
                <strong>internal_interpretive</strong> (0.5) — PM brief, meeting notes, draft
                PRD.
              </li>
              <li>
                <strong>speculative</strong> (0.2) — Slack guess, tribal knowledge.
              </li>
            </ul>
            <p className="mt-2">When in doubt, tag lower. Easier to promote later.</p>
          </>
        ),
      },
      {
        q: "Is vendor_version required?",
        a: (
          <p>
            Optional, but valuable. Drives supersession detection: when you re-upload an
            updated version of the same content, the system can recognize it and mark the old
            one as superseded. If the version is visible on the doc (e.g.,{" "}
            <code>v3</code>, <code>2.5.1</code>, <code>2024-Q4</code>), the system will
            auto-infer it and pre-fill the field. Confirm or edit on the review page.
          </p>
        ),
      },
    ],
  },
  {
    title: "Using MCP from your AI tools",
    items: [
      {
        q: "How do I connect Claude Desktop / Cursor?",
        a: (
          <p>
            Visit{" "}
            <Link href="/mcp-setup" className="text-blue-700 hover:underline">
              MCP Setup
            </Link>{" "}
            and paste the pre-filled JSON config into your Claude Desktop config file. Restart
            Claude Desktop. Your token expires roughly hourly; revisit and re-copy when it
            stops working.
          </p>
        ),
      },
      {
        q: "What can I ask Claude/Cursor once it's set up?",
        a: (
          <>
            <p>Three tools are exposed:</p>
            <ul className="ml-5 mt-1 list-disc space-y-1 text-sm">
              <li>
                <code>search_knowledge</code> — natural-language search across all verified
                content. Best for &ldquo;what does our team know about X?&rdquo; queries.
              </li>
              <li>
                <code>get_rules_for_topic</code> — verified business rules for a topic. Only
                returns rules that passed two-person verification.
              </li>
              <li>
                <code>get_api_endpoint</code> — structured endpoint lookup by HTTP method +
                path. Returns operation_id, parameters, request body, responses.
              </li>
            </ul>
            <p className="mt-2">Example prompts that work:</p>
            <ul className="ml-5 mt-1 list-disc space-y-1 text-sm italic text-gray-700">
              <li>&ldquo;What are the verified rules for lead management?&rdquo;</li>
              <li>
                &ldquo;Find me docs about reporting and analytics.&rdquo;
              </li>
              <li>
                &ldquo;What does the POST /leads endpoint require?&rdquo;
              </li>
              <li>
                &ldquo;Draft a brief on our integration with vendor X based on what&apos;s in
                the knowledge base.&rdquo;
              </li>
            </ul>
          </>
        ),
      },
      {
        q: "My MCP queries stopped working. What broke?",
        a: (
          <p>
            Most likely your access token expired. Revisit{" "}
            <Link href="/mcp-setup" className="text-blue-700 hover:underline">
              MCP Setup
            </Link>
            , copy a fresh token, paste it into your config, and restart Claude Desktop /
            Cursor.
          </p>
        ),
      },
    ],
  },
  {
    title: "Mistakes & recovery",
    items: [
      {
        q: "I uploaded something by mistake. Can I delete it?",
        a: (
          <p>
            We never hard-delete. Ask an admin to set the artifact&apos;s status to{" "}
            <code>archived</code> — it stays in the database for audit but drops out of
            default retrieval. Same for topics and rules.
          </p>
        ),
      },
      {
        q: "I accepted a rule that turned out to be wrong.",
        a: (
          <p>
            A verifier can re-open the rule by marking its status <code>disputed</code> with
            notes. The MCP layer filters to <code>status=&apos;active&apos; AND human_verified=true</code>{" "}
            only, so disputed rules immediately stop appearing in engineering queries.
          </p>
        ),
      },
      {
        q: "Who do I ask for help?",
        a: (
          <p>
            The user with <code>role=&apos;admin&apos;</code> is the system owner. Topic
            owners for individual taxonomies vary — check the topic&apos;s record for the
            assigned owner.
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">FAQ</h1>
        <p className="mt-1 text-sm text-gray-600">
          How to use the PM Knowledge Base. Skim the headings; click any question to expand.
        </p>
      </header>

      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-3">
          <h2 className="border-b border-gray-200 pb-1 text-lg font-semibold text-gray-800">
            {section.title}
          </h2>
          {section.intro && <p className="text-sm text-gray-700">{section.intro}</p>}
          <div className="flex flex-col gap-2">
            {section.items.map((item, i) => (
              <details
                key={i}
                className="rounded border border-gray-200 bg-white p-3 text-sm open:border-gray-400"
              >
                <summary className="cursor-pointer font-medium text-gray-900">
                  {item.q}
                </summary>
                <div className="mt-2 text-gray-700">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <footer className="border-t border-gray-200 pt-4 text-xs text-gray-500">
        Missing something? Open a PR — additions are easy. Source of this page:{" "}
        <code>src/app/faq/page.tsx</code>.
      </footer>
    </main>
  );
}
