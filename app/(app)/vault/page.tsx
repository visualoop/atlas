"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  BookOpen, Swords, Quote, FileText, ClipboardList, Play,
  ShieldQuestion, Plus, Sparkles, Loader2, Search,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NoteEditor } from "@/components/atlas/note-editor";
import { formatDistanceToNowStrict } from "date-fns";

const KINDS = [
  { value: "playbook", label: "Playbooks", icon: BookOpen },
  { value: "battlecard", label: "Battlecards", icon: Swords },
  { value: "testimonial", label: "Testimonials", icon: Quote },
  { value: "case_study", label: "Case studies", icon: FileText },
  { value: "one_pager", label: "One-pagers", icon: ClipboardList },
  { value: "demo_script", label: "Demo scripts", icon: Play },
  { value: "objection", label: "Objections", icon: ShieldQuestion },
] as const;
type Kind = (typeof KINDS)[number]["value"];

const KIND_ICON = Object.fromEntries(KINDS.map((k) => [k.value, k.icon])) as unknown as Record<Kind, React.ComponentType<{ className?: string }>>;

export default function VaultPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [activeId, setActiveId] = useState<Id<"salesAssets"> | null>(null);

  const assets = useQuery(api.salesAssets.listAssets, {
    kind: kind ?? undefined,
    search: search.trim() || undefined,
    limit: 200,
  });

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <header className="mb-8">
          <p className="eyebrow">Sales Enablement Vault</p>
          <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
            Ammunition for <em className="italic font-display">the pitch</em>.
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose mt-2">
            Playbooks, battlecards, testimonials, case studies. Pull them into
            any conversation via ⌘K. Track which pieces actually close deals.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 md:gap-8">
          {/* Left rail — kind filter */}
          <aside className="space-y-1">
            <Button
              variant="ghost"
              onClick={() => setKind(null)}
              className={cn(
                "w-full justify-start h-8 text-sm font-normal",
                kind === null
                  ? "bg-muted/60 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              All
            </Button>
            {KINDS.map((k) => {
              const Icon = k.icon;
              return (
                <Button
                  key={k.value}
                  variant="ghost"
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "w-full justify-start h-8 text-sm font-normal",
                    kind === k.value
                      ? "bg-muted/60 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {k.label}
                </Button>
              );
            })}
          </aside>

          {/* Right — list */}
          <main className="space-y-4 min-w-0">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 z-10" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search content…"
                  className="pl-10"
                />
              </div>
              <Button
                onClick={() => setNewOpen(true)}
                size="lg"
                className="text-xs font-mono uppercase tracking-[0.12em]"
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>

            {assets === undefined ? (
              <VaultSkeleton />
            ) : assets.length === 0 ? (
              <EmptyVault kind={kind} onCreate={() => setNewOpen(true)} />
            ) : (
              <ul className="border border-border divide-y divide-border">
                {assets.map((a) => (
                  <AssetRow
                    key={a._id}
                    asset={a}
                    onOpen={() => setActiveId(a._id)}
                  />
                ))}
              </ul>
            )}
          </main>
        </div>
      </div>

      {newOpen && <NewAssetDialog onClose={() => setNewOpen(false)} />}
      {activeId && (
        <AssetSheet
          assetId={activeId}
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function AssetRow({
  asset: a, onOpen,
}: { asset: Doc<"salesAssets">; onOpen: () => void }) {
  const Icon = KIND_ICON[a.kind as Kind] ?? BookOpen;
  return (
    <li>
      <button
        onClick={onOpen}
        className="w-full text-left px-4 py-4 hover:bg-muted/40 transition-colors flex items-start gap-4"
      >
        <Icon className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 justify-between">
            <p className="font-medium text-sm truncate">{a.title}</p>
            <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-muted-foreground">
              {a.productId && (
                <span className="uppercase tracking-[0.12em]">{a.productId}</span>
              )}
              {a.usageCount > 0 && (
                <span className="num">Used {a.usageCount}×</span>
              )}
              {a.lastUsedAt && (
                <span className="num">
                  {formatDistanceToNowStrict(new Date(a.lastUsedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {a.bodyText || "(empty)"}
          </p>
          {a.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {a.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-mono text-muted-foreground border border-border px-1.5 py-0.5"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

function VaultSkeleton() {
  return (
    <div className="border border-border divide-y divide-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-4 flex items-start gap-4">
          <Skeleton className="size-4" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyVault({ kind, onCreate }: { kind: Kind | null; onCreate: () => void }) {
  const label = kind ? kind.replace(/_/g, " ") : "asset";
  return (
    <div className="border border-dashed border-border py-16 text-center space-y-3">
      <p className="font-display italic text-2xl text-muted-foreground">Nothing here yet.</p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Add your first {label} — a piece of reference material that helps you
        close faster next time.
      </p>
      <Button
        onClick={onCreate}
        size="lg"
        className="font-mono uppercase tracking-[0.12em] text-xs"
      >
        <Plus className="size-3.5" /> New {label}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New asset dialog                                                      */
/* ------------------------------------------------------------------ */

function NewAssetDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("playbook");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<unknown>({ type: "doc", content: [] });
  const [productId, setProductId] = useState<string>("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.salesAssets.createAsset);

  async function submit() {
    if (title.trim().length < 3) {
      toast.error("Give it a title.");
      return;
    }
    setSaving(true);
    try {
      await create({
        kind,
        title: title.trim(),
        body,
        tags: tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
        productId: productId.trim() || undefined,
      });
      toast.success("Added to vault.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <header className="px-6 pt-5 pb-3 border-b border-border sticky top-0 bg-background">
          <p className="eyebrow font-mono text-muted-foreground">New vault entry</p>
          <h2 className="font-display italic text-2xl mt-1">What's the <em>weapon</em>?</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <Button
                key={k.value}
                type="button"
                variant={kind === k.value ? "default" : "outline"}
                size="sm"
                onClick={() => setKind(k.value)}
                className={cn(
                  "h-8 text-xs font-mono uppercase tracking-[0.12em]",
                  kind === k.value && "bg-foreground text-background hover:bg-foreground/90",
                )}
              >
                <k.icon className="size-3" />
                {k.label}
              </Button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Title</span>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Java House objection: 'Too expensive'"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Body</span>
            <NoteEditor
              placeholder="Write the play…"
              onChange={setBody}
              onSubmit={submit}
              minHeight={200}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Product</span>
              <Select
                value={productId || "__any__"}
                onValueChange={(v) => setProductId(v && v !== "__any__" ? v : "")}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">— Any —</SelectItem>
                  <SelectItem value="omnix">Omnix</SelectItem>
                  <SelectItem value="blyss_studio">Blyss Studio</SelectItem>
                  <SelectItem value="marketplace">Marketplace</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Tags</span>
              <Input
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="pricing, discovery"
              />
            </label>
          </div>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end sticky bottom-0 bg-background">
          <Button
            variant="ghost"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="h-8 px-5 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Save
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Asset detail sheet                                                    */
/* ------------------------------------------------------------------ */

function AssetSheet({
  assetId, onClose,
}: {
  assetId: Id<"salesAssets">;
  onClose: () => void;
}) {
  const asset = useQuery(api.salesAssets.getAsset, { id: assetId });
  const update = useMutation(api.salesAssets.updateAsset);
  const trackUse = useMutation(api.salesAssets.trackUse);
  const archive = useMutation(api.salesAssets.archiveAsset);

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-background/60 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border-l border-border w-full max-w-2xl h-full overflow-y-auto shadow-2xl">
        {asset === undefined ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : asset === null ? (
          <div className="p-8 text-center">
            <p className="font-display italic text-muted-foreground">Not found.</p>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6">
            <header className="space-y-1">
              <p className="eyebrow font-mono text-muted-foreground capitalize">
                {asset.kind.replace(/_/g, " ")}
                {asset.productId && ` · ${asset.productId}`}
              </p>
              <h2 className="font-display italic text-3xl leading-tight">{asset.title}</h2>
            </header>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={async () => {
                  await trackUse({ id: assetId });
                  navigator.clipboard.writeText(asset.bodyText);
                  toast.success("Copied to clipboard.");
                }}
                size="sm"
                className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
              >
                <Sparkles className="size-3.5" />
                Use + copy
              </Button>
              <span className="text-[10px] font-mono text-muted-foreground">
                Used {asset.usageCount}× · Created {formatDistanceToNowStrict(new Date(asset._creationTime), { addSuffix: true })}
              </span>
            </div>

            <article
              className="prose prose-sm max-w-none prose-neutral dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: tiptapToHtml(asset.body) }}
            />

            {asset.tags.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="eyebrow font-mono text-muted-foreground mb-2">Tags</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {asset.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[11px] font-mono text-muted-foreground border border-border px-2 py-0.5"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <Button
                variant="link"
                onClick={async () => {
                  if (!confirm("Archive this asset?")) return;
                  await archive({ id: assetId });
                  toast.success("Archived.");
                  onClose();
                }}
                className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em] text-[var(--danger)]"
              >
                Archive
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function tiptapToHtml(body: unknown): string {
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { level?: number } };
    if (n.type === "paragraph") {
      chunks.push("<p>");
      n.content?.forEach(walk);
      chunks.push("</p>");
      return;
    }
    if (n.type === "heading") {
      const lvl = n.attrs?.level ?? 2;
      chunks.push(`<h${lvl}>`);
      n.content?.forEach(walk);
      chunks.push(`</h${lvl}>`);
      return;
    }
    if (n.type === "bulletList") {
      chunks.push("<ul>");
      n.content?.forEach(walk);
      chunks.push("</ul>");
      return;
    }
    if (n.type === "orderedList") {
      chunks.push("<ol>");
      n.content?.forEach(walk);
      chunks.push("</ol>");
      return;
    }
    if (n.type === "listItem") {
      chunks.push("<li>");
      n.content?.forEach(walk);
      chunks.push("</li>");
      return;
    }
    if (n.type === "blockquote") {
      chunks.push("<blockquote>");
      n.content?.forEach(walk);
      chunks.push("</blockquote>");
      return;
    }
    if (n.text) {
      chunks.push(escapeHtml(n.text));
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(body);
  return chunks.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
