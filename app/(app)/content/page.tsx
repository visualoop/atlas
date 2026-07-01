"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import {
  Send, Users as UsersIcon, FileText, Globe, Sparkles, Plus, Loader2,
  ExternalLink, Copy, Check, TrendingUp, X, Edit,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { LandingPageEditSheet } from "./landing-edit-sheet";

type Tab = "newsletter" | "landing" | "seo";

export default function ContentHubPage() {
  const [tab, setTab] = useState<Tab>("newsletter");

  return (
    <div className="max-w-7xl mx-auto px-8 py-8">
      <header className="mb-8">
        <p className="eyebrow">Content Hub</p>
        <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
          Newsletters, pages, <em className="italic font-display">ideas</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose mt-2">
          Broadcast to audiences, publish landing pages, and let AI keep
          the SEO idea backlog full.
        </p>
      </header>

      <div className="border-b border-border mb-6 flex items-center gap-1 overflow-x-auto">
        <TabButton active={tab === "newsletter"} onClick={() => setTab("newsletter")} icon={<Send className="size-3.5" />}>
          Newsletters
        </TabButton>
        <TabButton active={tab === "landing"} onClick={() => setTab("landing")} icon={<Globe className="size-3.5" />}>
          Landing pages
        </TabButton>
        <TabButton active={tab === "seo"} onClick={() => setTab("seo")} icon={<TrendingUp className="size-3.5" />}>
          SEO backlog
        </TabButton>
      </div>

      {tab === "newsletter" && <NewsletterTab />}
      {tab === "landing" && <LandingTab />}
      {tab === "seo" && <SeoTab />}
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 h-10 text-sm border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ================================================================== */
/* Newsletter tab                                                       */
/* ================================================================== */

function NewsletterTab() {
  const audiences = useQuery(api.content.listAudiences, {});
  const broadcasts = useQuery(api.content.listBroadcasts, { limit: 100 });
  const createAudience = useMutation(api.content.createAudience);
  const createBroadcast = useMutation(api.content.createBroadcast);

  const [newAudienceOpen, setNewAudienceOpen] = useState(false);
  const [newBroadcastOpen, setNewBroadcastOpen] = useState(false);

  return (
    <div className="grid grid-cols-[280px_1fr] gap-8">
      <aside className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Audiences</p>
          <button
            onClick={() => setNewAudienceOpen(true)}
            className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline inline-flex items-center gap-1"
          >
            <Plus className="size-3.5" /> New
          </button>
        </div>
        {audiences === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : audiences.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No audiences yet.</p>
        ) : (
          <ul className="border border-border divide-y divide-border">
            {audiences.map((a) => (
              <li key={a._id} className="px-3 py-2.5">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground num">{a.memberCount} members</p>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Broadcasts</p>
          <button
            onClick={() => setNewBroadcastOpen(true)}
            disabled={!audiences || audiences.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform disabled:opacity-50"
          >
            <Plus className="size-3.5" /> New broadcast
          </button>
        </div>
        {broadcasts === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center space-y-2">
            <p className="font-display italic text-xl text-muted-foreground">No broadcasts yet.</p>
            <p className="text-sm text-muted-foreground">
              {audiences?.length === 0 ? "Create an audience first." : "Compose your first send."}
            </p>
          </div>
        ) : (
          <ul className="border border-border divide-y divide-border">
            {broadcasts.map((b) => (
              <BroadcastRow key={b._id} broadcast={b} />
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground italic">
          Draft broadcasts, hit "Send now" from the row detail — dispatch fans
          out through your Resend key with per-member idempotency.
        </p>
      </section>

      {newAudienceOpen && (
        <SimpleDialog
          title="New audience"
          onClose={() => setNewAudienceOpen(false)}
          onSubmit={async ({ name, description }) => {
            await createAudience({ name, description });
            toast.success("Audience created.");
          }}
          fields={[
            { key: "name", label: "Name", placeholder: "Weekly newsletter" },
            { key: "description", label: "Description", optional: true, placeholder: "What's this list for?" },
          ]}
        />
      )}
      {newBroadcastOpen && audiences && (
        <NewBroadcastDialog
          audiences={audiences}
          onClose={() => setNewBroadcastOpen(false)}
          onSubmit={async (v) => {
            await createBroadcast(v);
            toast.success("Draft created.");
          }}
        />
      )}
    </div>
  );
}

function BroadcastRow({ broadcast: b }: { broadcast: Doc<"broadcasts"> }) {
  return (
    <li className="px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{b.name}</p>
        <p className="text-xs text-muted-foreground truncate">{b.subject}</p>
      </div>
      <StatusPill status={b.status} />
      <span className="text-xs text-muted-foreground num shrink-0 w-16 text-right">
        {b.recipientCount}
      </span>
      <span className="text-xs text-muted-foreground num shrink-0 w-16 text-right">
        {b.sentAt
          ? formatDistanceToNowStrict(new Date(b.sentAt), { addSuffix: true })
          : "—"}
      </span>
    </li>
  );
}

function NewBroadcastDialog({
  audiences, onClose, onSubmit,
}: {
  audiences: Doc<"audiences">[];
  onClose: () => void;
  onSubmit: (args: { name: string; audienceId: Id<"audiences">; subject: string; preheader?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState<Id<"audiences">>(audiences[0]._id);
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (name.trim().length < 3 || subject.trim().length < 3) {
      toast.error("Add a name and subject.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        audienceId,
        subject: subject.trim(),
        preheader: preheader.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New broadcast" onClose={onClose} disabled={saving}>
      <div className="px-6 py-4 space-y-3">
        <Field label="Internal name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly digest — Jan 30"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
        </Field>
        <Field label="Audience">
          <select value={audienceId} onChange={(e) => setAudienceId(e.target.value as Id<"audiences">)}
            className="w-full h-9 px-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none">
            {audiences.map((a) => (
              <option key={a._id} value={a._id}>{a.name} ({a.memberCount})</option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="What's in the inbox?"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
        </Field>
        <Field label="Preheader" optional>
          <input value={preheader} onChange={(e) => setPreheader(e.target.value)}
            placeholder="Preview text that shows next to the subject"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
        </Field>
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} saving={saving} label="Create draft" />
    </ModalShell>
  );
}

/* ================================================================== */
/* Landing tab                                                          */
/* ================================================================== */

function LandingTab() {
  const pages = useQuery(api.content.listLandingPages, {});
  const create = useMutation(api.content.createLandingPage);
  const publish = useMutation(api.content.publishLandingPage);
  const archive = useMutation(api.content.archiveLandingPage);

  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Landing pages</p>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          <Plus className="size-3.5" /> New page
        </button>
      </div>
      {pages === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : pages.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-center space-y-2">
          <p className="font-display italic text-xl text-muted-foreground">No landing pages yet.</p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Templates for product launches, waitlists, events, and lead magnets.
            Each captures signups directly into your CRM + audiences.
          </p>
        </div>
      ) : (
        <ul className="border border-border divide-y divide-border">
          {pages.map((p) => (
            <LandingPageRow
              key={p._id}
              page={p}
              onPublish={() => publish({ id: p._id })}
              onArchive={() => archive({ id: p._id })}
            />
          ))}
        </ul>
      )}
      {newOpen && (
        <NewLandingPageDialog
          onClose={() => setNewOpen(false)}
          onCreate={async (args) => {
            await create(args);
            toast.success("Draft created.");
          }}
        />
      )}
    </div>
  );
}

function LandingPageRow({
  page: p, onPublish, onArchive,
}: {
  page: Doc<"landingPages">;
  onPublish: () => void;
  onArchive: () => void;
}) {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const wsSlug = bootstrap?.activeWorkspace?.slug ?? "";
  const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${wsSlug}/${p.slug}`;
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <li className="px-4 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium">{p.title}</p>
          <StatusPill status={p.status} />
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            {p.kind.replace("_", " ")}
          </span>
        </div>
        {p.subtitle && (
          <p className="text-xs text-muted-foreground truncate">{p.subtitle}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground num">
          <span>{p.viewCount} views</span>
          <span>{p.signupCount} signups</span>
          {p.publishedAt && (
            <span>
              published {formatDistanceToNowStrict(new Date(p.publishedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setEditOpen(true)}
          title="Edit body"
          className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Edit className="size-3.5" />
        </button>
        {p.status === "published" && wsSlug && (
          <>
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("Link copied.");
              }}
              title="Copy public URL"
              className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Open"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </>
        )}
        {p.status === "draft" && (
          <button
            onClick={onPublish}
            className="text-xs font-mono uppercase tracking-[0.12em] px-3 h-8 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
          >
            Publish
          </button>
        )}
      </div>
    </li>
    {editOpen && <LandingPageEditSheet page={p} onClose={() => setEditOpen(false)} />}
    </>
  );
}

function NewLandingPageDialog({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (args: {
    slug: string;
    kind: "product_launch" | "waitlist" | "event" | "lead_magnet" | "custom";
    title: string;
    subtitle?: string;
  }) => Promise<void>;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [kind, setKind] = useState<"product_launch" | "waitlist" | "event" | "lead_magnet" | "custom">("product_launch");
  const [saving, setSaving] = useState(false);

  const KINDS = [
    { value: "product_launch" as const, label: "Product launch" },
    { value: "waitlist" as const, label: "Waitlist" },
    { value: "event" as const, label: "Event" },
    { value: "lead_magnet" as const, label: "Lead magnet" },
    { value: "custom" as const, label: "Custom" },
  ];

  async function submit() {
    if (!slug.trim() || !title.trim()) {
      toast.error("Slug and title are required.");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        slug: slug.trim(),
        kind,
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New landing page" onClose={onClose} disabled={saving}>
      <div className="px-6 py-4 space-y-3">
        <Field label="Kind">
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value)}
                className={cn(
                  "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
                  kind === k.value
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Omnix launches"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
        </Field>
        <Field label="Slug">
          <input value={slug} onChange={(e) => setSlug(e.target.value)}
            placeholder="omnix-launch"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono" />
          <p className="text-[11px] text-muted-foreground mt-1">
            URL will be /p/&lt;workspace&gt;/<code className="font-mono">{slug || "your-slug"}</code>
          </p>
        </Field>
        <Field label="Subtitle" optional>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
            placeholder="A one-line pitch"
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
        </Field>
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} saving={saving} label="Create" />
    </ModalShell>
  );
}

/* ================================================================== */
/* SEO tab                                                              */
/* ================================================================== */

function SeoTab() {
  const [status, setStatus] = useState<"new" | "shortlisted" | "drafting" | "published" | "dismissed" | undefined>("new");
  const ideas = useQuery(api.content.listSeoIdeas, { status, limit: 200 });
  const updateStatus = useMutation(api.content.updateSeoIdeaStatus);
  const createIdea = useMutation(api.content.createSeoIdea);
  const [newOpen, setNewOpen] = useState(false);

  const STATUSES = ["new", "shortlisted", "drafting", "published", "dismissed"] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
              status === s
                ? "bg-foreground text-background"
                : "border border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setNewOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          <Plus className="size-3.5" /> New idea
        </button>
      </div>
      {ideas === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : ideas.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-center space-y-2">
          <p className="font-display italic text-xl text-muted-foreground">
            {status === "new" ? "Backlog is empty." : `No ${status} ideas.`}
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Add manually below, or ask the Copilot (⌘J) — "give me 5 SEO
            angles for {"{"}our brand{"}"}" — and paste the best ones in.
          </p>
        </div>
      ) : (
        <ul className="border border-border divide-y divide-border">
          {ideas.map((i) => (
            <li key={i._id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium">{i.title}</p>
                <p className="text-xs text-muted-foreground italic">{i.angle}</p>
                {i.keywords.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {i.keywords.slice(0, 5).map((k) => (
                      <span key={k} className="text-[10px] font-mono text-muted-foreground border border-border px-1.5 py-0.5">
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] font-mono num text-muted-foreground">
                  {typeof i.priority === "number" ? `P${i.priority}` : ""}
                </span>
                {status !== "shortlisted" && i.status !== "shortlisted" && (
                  <button
                    onClick={() => updateStatus({ id: i._id, status: "shortlisted" })}
                    className="text-xs font-mono uppercase tracking-[0.12em] px-2 h-7 border border-border hover:border-foreground hover:bg-muted transition-colors"
                  >
                    Shortlist
                  </button>
                )}
                {i.status !== "dismissed" && (
                  <button
                    onClick={() => updateStatus({ id: i._id, status: "dismissed" })}
                    className="size-7 grid place-items-center text-muted-foreground hover:text-[var(--danger)]"
                    title="Dismiss"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {newOpen && (
        <SimpleDialog
          title="New idea"
          onClose={() => setNewOpen(false)}
          onSubmit={async ({ title, angle, keywords }) => {
            await createIdea({
              title,
              angle,
              keywords: keywords ? keywords.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            });
            toast.success("Added to backlog.");
          }}
          fields={[
            { key: "title", label: "Headline" },
            { key: "angle", label: "Angle" },
            { key: "keywords", label: "Keywords", optional: true, placeholder: "comma, separated" },
          ]}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* Shared bits                                                          */
/* ================================================================== */

function Field({
  label, children, optional,
}: { label: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}{optional && <span className="normal-case tracking-normal text-muted-foreground/60"> — optional</span>}
      </span>
      {children}
    </label>
  );
}

function ModalShell({
  title, onClose, disabled, children,
}: {
  title: string;
  onClose: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !disabled && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">{title}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  onClose, onSubmit, saving, label,
}: { onClose: () => void; onSubmit: () => void; saving: boolean; label: string }) {
  return (
    <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
      <button
        onClick={onClose}
        disabled={saving}
        className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={saving}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {label}
      </button>
    </footer>
  );
}

interface SimpleField {
  key: string;
  label: string;
  optional?: boolean;
  placeholder?: string;
}

function SimpleDialog({
  title, fields, onClose, onSubmit,
}: {
  title: string;
  fields: SimpleField[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ""])),
  );
  const [saving, setSaving] = useState(false);

  async function submit() {
    for (const f of fields) {
      if (!f.optional && !values[f.key].trim()) {
        toast.error(`${f.label} is required.`);
        return;
      }
    }
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={title} onClose={onClose} disabled={saving}>
      <div className="px-6 py-4 space-y-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} optional={f.optional}>
            <input
              autoFocus={f === fields[0]}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </Field>
        ))}
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} saving={saving} label="Save" />
    </ModalShell>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  scheduled: "border-[var(--info)] text-[var(--info)]",
  sending: "border-[var(--warning)] text-[var(--warning)]",
  sent: "border-[var(--success)] text-[var(--success)]",
  failed: "border-[var(--danger)] text-[var(--danger)]",
  cancelled: "border-border text-muted-foreground opacity-60",
  published: "border-[var(--success)] text-[var(--success)]",
  archived: "border-border text-muted-foreground opacity-60",
  new: "border-[var(--info)] text-[var(--info)]",
  shortlisted: "border-[var(--warning)] text-[var(--warning)]",
  drafting: "border-[var(--info)] text-[var(--info)]",
  dismissed: "border-border text-muted-foreground opacity-60",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5",
      STATUS_STYLES[status] ?? STATUS_STYLES.draft,
    )}>
      {status}
    </span>
  );
}
