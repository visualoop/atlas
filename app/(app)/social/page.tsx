"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  Facebook, Instagram, Linkedin, Send, Calendar as CalendarIcon,
  Plus, Loader2, X, ExternalLink, Image as ImageIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";

const PLATFORM_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  facebook_page: { icon: Facebook, label: "Facebook", color: "text-[#1877F2]" },
  instagram_business: { icon: Instagram, label: "Instagram", color: "text-[#E1306C]" },
  linkedin_personal: { icon: Linkedin, label: "LinkedIn", color: "text-[#0A66C2]" },
  linkedin_company: { icon: Linkedin, label: "LinkedIn (Co)", color: "text-[#0A66C2]" },
};

export default function SocialPage() {
  const connections = useQuery(api.social.listConnections, {});
  const posts = useQuery(api.social.listPosts, { limit: 100 });
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <>
      <div className="max-w-7xl mx-auto px-8 py-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Social Publishing</p>
            <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
              Post <em className="italic font-display">everywhere</em>.
            </h1>
            <p className="text-sm text-muted-foreground max-w-prose mt-2">
              One composer for Facebook, Instagram, and LinkedIn. Schedule ahead.
              Comments flow into the unified inbox.
            </p>
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            disabled={!connections || connections.length === 0}
            className={cn(
              "inline-flex items-center gap-2 h-10 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <Plus className="size-3.5" /> New post
          </button>
        </header>

        <ConnectionsBar connections={connections} />

        <section className="mt-8 space-y-2">
          <p className="eyebrow">Posts</p>
          {posts === undefined ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <EmptyPosts onCreate={() => setComposeOpen(true)} hasConnections={(connections?.length ?? 0) > 0} />
          ) : (
            <ul className="border border-border divide-y divide-border">
              {posts.map((p) => (
                <PostRow key={p._id} post={p} connections={connections ?? []} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {composeOpen && connections && (
        <ComposeSheet
          connections={connections}
          onClose={() => setComposeOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ConnectionsBar({
  connections,
}: {
  connections: Doc<"socialConnections">[] | undefined;
}) {
  if (connections === undefined) return <Skeleton className="h-16 w-full" />;
  if (connections.length === 0) {
    return (
      <div className="border border-dashed border-border p-6 text-center space-y-3">
        <p className="font-display italic text-xl text-muted-foreground">
          No accounts connected yet.
        </p>
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          Connect a Facebook Page, Instagram Business account, or LinkedIn
          profile to start posting.
        </p>
        <p className="text-xs text-muted-foreground italic">
          Connect via Composio at{" "}
          <a href="/settings/integrations" className="text-primary underline">
            Settings → Integrations → Composio
          </a>{" "}
          for a one-key OAuth flow across all three platforms. Direct
          connection is also possible via the Convex dashboard.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {connections.map((c) => {
        const meta = PLATFORM_META[c.platform];
        const Icon = meta?.icon ?? ExternalLink;
        return (
          <div
            key={c._id}
            className={cn(
              "flex items-center gap-2 px-3 h-9 border border-border",
              c.status !== "connected" && "opacity-60",
            )}
          >
            <Icon className={cn("size-4", meta?.color)} />
            <span className="text-sm">{c.displayName}</span>
            {c.status !== "connected" && (
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--warning)]">
                {c.status.replace("_", " ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PostRow({
  post: p, connections,
}: { post: Doc<"socialPosts">; connections: Doc<"socialConnections">[] }) {
  const targets = p.connectionIds
    .map((cid) => connections.find((c) => c._id === cid))
    .filter((c): c is Doc<"socialConnections"> => !!c);
  return (
    <li className="px-4 py-4 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <StatusPill status={p.status} />
          {targets.map((c) => {
            const meta = PLATFORM_META[c.platform];
            const Icon = meta?.icon ?? ExternalLink;
            return (
              <span key={c._id} title={c.displayName} className="inline-flex">
                <Icon className={cn("size-3.5", meta?.color)} />
              </span>
            );
          })}
          {p.scheduledFor && p.status === "scheduled" && (
            <span className="text-xs text-muted-foreground font-mono num">
              <CalendarIcon className="size-3 inline" /> {new Date(p.scheduledFor).toLocaleString("en-KE", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          )}
          {p.publishedAt && (
            <span className="text-xs text-muted-foreground font-mono num">
              Published {formatDistanceToNowStrict(new Date(p.publishedAt), { addSuffix: true })}
            </span>
          )}
        </div>
        <p className="text-sm line-clamp-3 whitespace-pre-wrap">{p.caption || "(empty)"}</p>
        {p.mediaFileIds.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ImageIcon className="size-3" />
            {p.mediaFileIds.length} media
          </div>
        )}
        {(p.likeCount || p.commentCount) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono num">
            {p.likeCount ? <span>♥ {p.likeCount}</span> : null}
            {p.commentCount ? <span>💬 {p.commentCount}</span> : null}
            {p.shareCount ? <span>↗ {p.shareCount}</span> : null}
          </div>
        )}
      </div>
    </li>
  );
}

function EmptyPosts({ onCreate, hasConnections }: { onCreate: () => void; hasConnections: boolean }) {
  return (
    <div className="border border-dashed border-border py-16 text-center space-y-3">
      <p className="font-display italic text-2xl text-muted-foreground">Nothing posted yet.</p>
      {hasConnections ? (
        <button
          onClick={onCreate}
          className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          + New post
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">Connect an account to get started.</p>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  scheduled: "border-[var(--info)] text-[var(--info)]",
  publishing: "border-[var(--warning)] text-[var(--warning)]",
  published: "border-[var(--success)] text-[var(--success)]",
  failed: "border-[var(--danger)] text-[var(--danger)]",
  cancelled: "border-border text-muted-foreground opacity-60",
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

/* ------------------------------------------------------------------ */
/* Compose sheet                                                         */
/* ------------------------------------------------------------------ */

function ComposeSheet({
  connections, onClose,
}: {
  connections: Doc<"socialConnections">[];
  onClose: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<Set<Id<"socialConnections">>>(new Set());
  const [scheduleTime, setScheduleTime] = useState("");
  const [saving, setSaving] = useState(false);
  const createPost = useMutation(api.social.createPost);
  const publishNow = useMutation(api.social.publishPostNow);

  const canSubmit = caption.trim().length > 0 && selected.size > 0;

  async function submit(action: "draft" | "schedule" | "publish") {
    setSaving(true);
    try {
      const scheduledFor = action === "schedule" && scheduleTime
        ? new Date(scheduleTime).getTime()
        : undefined;
      const id = await createPost({
        connectionIds: Array.from(selected),
        caption,
        scheduledFor,
      });
      if (action === "publish") {
        await publishNow({ id });
        toast.success("Publish queued.");
      } else if (action === "schedule") {
        toast.success("Scheduled.");
      } else {
        toast.success("Saved as draft.");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border-l border-border w-full max-w-2xl h-full overflow-y-auto shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border flex items-start justify-between sticky top-0 bg-background z-10">
          <div>
            <p className="eyebrow font-mono text-muted-foreground">Compose post</p>
            <h2 className="font-display italic text-2xl mt-1">Where should it <em>land</em>?</h2>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {/* Platforms */}
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground mb-2">
              Post to
            </p>
            <div className="flex flex-wrap gap-1.5">
              {connections.map((c) => {
                const meta = PLATFORM_META[c.platform];
                const Icon = meta?.icon ?? ExternalLink;
                const active = selected.has(c._id);
                return (
                  <button
                    key={c._id}
                    onClick={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c._id)) next.delete(c._id);
                        else next.add(c._id);
                        return next;
                      });
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 h-9 px-3 text-xs transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "border border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-3.5", !active && meta?.color)} />
                    {c.displayName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Caption */}
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Caption
            </span>
            <textarea
              autoFocus
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={10}
              placeholder="What's on your mind?"
              className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>{caption.length} chars</span>
              <span>
                {caption.length > 2200 && "Instagram limit 2200 · "}
                {caption.length > 280 && "Twitter would truncate · "}
                Recommend under 500 for engagement
              </span>
            </div>
          </label>

          {/* Schedule */}
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Schedule <span className="normal-case tracking-normal text-muted-foreground/60">— optional</span>
            </span>
            <input
              type="datetime-local"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
            />
          </label>

          <p className="text-[11px] text-muted-foreground italic">
            On publish, Atlas routes through your Composio Slack / Meta /
            LinkedIn action if the workspace has a connection, else it
            drops into the scheduler as a manual reminder.
          </p>
        </div>

        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end sticky bottom-0 bg-background">
          <button
            onClick={() => submit("draft")}
            disabled={saving || !canSubmit}
            className="inline-flex items-center h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Save draft
          </button>
          {scheduleTime && (
            <button
              onClick={() => submit("schedule")}
              disabled={saving || !canSubmit}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              <CalendarIcon className="size-3.5" /> Schedule
            </button>
          )}
          <button
            onClick={() => submit("publish")}
            disabled={saving || !canSubmit}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Publish now
          </button>
        </footer>
      </div>
    </div>
  );
}
