"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import Link from "next/link";
import {
  Send, Users as UsersIcon, FileText, Globe, Sparkles, Plus, Loader2,
  ExternalLink, Copy, Check, TrendingUp, X, Edit,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { LandingPageEditSheet } from "./landing-edit-sheet";

type Tab = "newsletter" | "landing" | "seo";

export default function ContentHubPage() {
  const [tab, setTab] = useState<Tab>("newsletter");

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
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
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn(
        "px-4 h-10 rounded-none border-b-2 hover:bg-transparent",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </Button>
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
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
      <aside className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Audiences</p>
          <Button
            variant="link"
            onClick={() => setNewAudienceOpen(true)}
            className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em]"
          >
            <Plus className="size-3.5" /> New
          </Button>
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
          <Button
            onClick={() => setNewBroadcastOpen(true)}
            disabled={!audiences || audiences.length === 0}
            className="text-xs font-mono uppercase tracking-[0.12em]"
          >
            <Plus className="size-3.5" /> New broadcast
          </Button>
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
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly digest — Jan 30" />
        </Field>
        <Field label="Audience">
          <Select value={audienceId} onValueChange={(v) => v && setAudienceId(v as Id<"audiences">)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {audiences.map((a) => (
                <SelectItem key={a._id} value={a._id}>{a.name} ({a.memberCount})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="What's in the inbox?" />
        </Field>
        <Field label="Preheader" optional>
          <Input value={preheader} onChange={(e) => setPreheader(e.target.value)}
            placeholder="Preview text that shows next to the subject" />
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
        <Button
          onClick={() => setNewOpen(true)}
          className="text-xs font-mono uppercase tracking-[0.12em]"
        >
          <Plus className="size-3.5" /> New page
        </Button>
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditOpen(true)}
          title="Edit body"
        >
          <Edit className="size-3.5" />
        </Button>
        {p.status === "published" && wsSlug && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("Link copied.");
              }}
              title="Copy public URL"
            >
              {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            </Button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-md"
              title="Open"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </>
        )}
        {p.status === "draft" && (
          <Button
            size="sm"
            onClick={onPublish}
            className="text-xs font-mono uppercase tracking-[0.12em] h-8"
          >
            Publish
          </Button>
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
              <Button
                key={k.value}
                type="button"
                variant={kind === k.value ? "default" : "outline"}
                size="sm"
                onClick={() => setKind(k.value)}
                className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
              >
                {k.label}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Omnix launches" />
        </Field>
        <Field label="Slug">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)}
            placeholder="omnix-launch" className="font-mono" />
          <p className="text-[11px] text-muted-foreground mt-1">
            URL will be /p/&lt;workspace&gt;/<code className="font-mono">{slug || "your-slug"}</code>
          </p>
        </Field>
        <Field label="Subtitle" optional>
          <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
            placeholder="A one-line pitch" />
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
  const brainstorm = useAction(api.publisherAI.brainstormContentIdeas);
  const [newOpen, setNewOpen] = useState(false);
  const [brainstorming, setBrainstorming] = useState(false);

  async function handleBrainstorm() {
    setBrainstorming(true);
    try {
      const r = await brainstorm({ count: 5 });
      if (r.ideas.length === 0) {
        toast.error("AI returned no ideas — try refining workspace context.");
        return;
      }
      for (const idea of r.ideas) {
        await createIdea({
          title: idea.title.slice(0, 200),
          keywords: [],
          angle: idea.angle.slice(0, 300),
        });
      }
      toast.success(`Added ${r.ideas.length} ideas to backlog.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI brainstorm failed.");
    } finally {
      setBrainstorming(false);
    }
  }

  const STATUSES = ["new", "shortlisted", "drafting", "published", "dismissed"] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 flex-wrap">
        {STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatus(s)}
            className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {s}
          </Button>
        ))}
        <Button
          onClick={() => setNewOpen(true)}
          size="sm"
          className="ml-auto h-8 text-xs font-mono uppercase tracking-[0.12em]"
        >
          <Plus className="size-3.5" /> New idea
        </Button>
        <Button
          onClick={handleBrainstorm}
          disabled={brainstorming}
          variant="outline"
          size="sm"
          className="h-8 text-xs font-mono uppercase tracking-[0.12em] border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
        >
          {brainstorming ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Brainstorm with AI
        </Button>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateStatus({ id: i._id, status: "shortlisted" })}
                    className="h-7 text-xs font-mono uppercase tracking-[0.12em]"
                  >
                    Shortlist
                  </Button>
                )}
                {i.status !== "dismissed" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 hover:text-[var(--danger)]"
                    onClick={() => updateStatus({ id: i._id, status: "dismissed" })}
                    title="Dismiss"
                  >
                    <X className="size-3.5" />
                  </Button>
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
      <Button
        variant="ghost"
        onClick={onClose}
        disabled={saving}
        className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
      >
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        disabled={saving}
        className="h-8 px-5 text-xs font-mono uppercase tracking-[0.12em]"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {label}
      </Button>
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
            <Input
              autoFocus={f === fields[0]}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
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
