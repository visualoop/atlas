"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Mail, MessageSquare, Inbox as InboxIcon, Star, Archive as ArchiveIcon,
  Clock, Reply, Pen, Sparkles, Loader2, ChevronLeft,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ComposeSheet } from "./compose-sheet";
import { ReplyBar } from "./reply-bar";

type ChannelFilter = "all" | "email" | "whatsapp";
type StateFilter = "open" | "pinned" | "snoozed" | "archived";

export default function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeId = searchParams.get("id") as Id<"conversations"> | null;

  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [state, setState] = useState<StateFilter>("open");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  const conversations = useQuery(api.emails.listInbox, {
    channel,
    state,
    search: search.trim() || undefined,
    limit: 100,
  });

  function setActiveId(id: Id<"conversations"> | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("id", id);
    else params.delete("id");
    router.replace(`${pathname}${params.toString() ? "?" + params.toString() : ""}`);
  }

  // Auto-open first conversation if none selected & desktop
  useEffect(() => {
    if (!activeId && conversations && conversations.length > 0) {
      setActiveId(conversations[0]._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations?.length]);

  const activeIndex = useMemo(
    () => conversations?.findIndex((c) => c._id === activeId) ?? -1,
    [conversations, activeId],
  );

  // Keyboard shortcuts — j/k/r/a/c/e/#/!
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement)?.getAttribute("contenteditable") === "true";
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (!conversations || conversations.length === 0) return;

      const current = activeIndex >= 0 ? activeIndex : 0;
      if (e.key === "j") {
        const next = conversations[Math.min(current + 1, conversations.length - 1)];
        if (next) setActiveId(next._id);
        e.preventDefault();
      } else if (e.key === "k") {
        const next = conversations[Math.max(current - 1, 0)];
        if (next) setActiveId(next._id);
        e.preventDefault();
      } else if (e.key === "c") {
        setComposeOpen(true);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeIndex]);

  return (
    <>
      <div className="h-[calc(100vh-3rem)] grid grid-cols-1 md:grid-cols-[220px_360px_1fr] lg:grid-cols-[220px_360px_1fr] gap-0 border-t border-border">
        {/* Left rail — folders / channels — hidden on mobile (use bottom sheet or omit) */}
        <aside className="hidden md:block border-r border-border p-4 space-y-6 overflow-y-auto">
          <div>
            <button
              onClick={() => setComposeOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.98] transition-transform"
            >
              <Pen className="size-3.5" /> Compose
              <span className="ml-auto text-primary-foreground/70 font-mono normal-case tracking-normal text-[10px]">
                C
              </span>
            </button>
          </div>

          <Section title="Folders">
            <RailButton
              icon={<InboxIcon className="size-3.5" />}
              label="Inbox"
              active={state === "open"}
              onClick={() => setState("open")}
            />
            <RailButton
              icon={<Star className="size-3.5" />}
              label="Pinned"
              active={state === "pinned"}
              onClick={() => setState("pinned")}
            />
            <RailButton
              icon={<Clock className="size-3.5" />}
              label="Snoozed"
              active={state === "snoozed"}
              onClick={() => setState("snoozed")}
            />
            <RailButton
              icon={<ArchiveIcon className="size-3.5" />}
              label="Archived"
              active={state === "archived"}
              onClick={() => setState("archived")}
            />
          </Section>

          <Section title="Channels">
            <RailButton
              label="All"
              active={channel === "all"}
              onClick={() => setChannel("all")}
            />
            <RailButton
              icon={<Mail className="size-3.5" />}
              label="Email"
              active={channel === "email"}
              onClick={() => setChannel("email")}
            />
            <RailButton
              icon={<MessageSquare className="size-3.5" />}
              label="WhatsApp"
              active={channel === "whatsapp"}
              onClick={() => setChannel("whatsapp")}
            />
          </Section>
        </aside>

        {/* Middle pane — thread list */}
        <div className={cn(
          "border-r border-border flex-col min-h-0",
          activeId ? "hidden md:flex" : "flex",
        )}>
          <div className="border-b border-border px-4 h-11 flex items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject…"
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations === undefined ? (
              <ThreadListSkeleton />
            ) : conversations.length === 0 ? (
              <EmptyList state={state} channel={channel} onCompose={() => setComposeOpen(true)} />
            ) : (
              <ul>
                {conversations.map((c) => (
                  <ThreadRow
                    key={c._id}
                    conversation={c}
                    active={activeId === c._id}
                    onClick={() => setActiveId(c._id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right pane — thread reader */}
        <div className={cn(
          "min-h-0 overflow-y-auto",
          activeId ? "block" : "hidden md:block",
        )}>
          {activeId ? (
            <ThreadReader conversationId={activeId} onClose={() => setActiveId(null)} />
          ) : (
            <div className="h-full grid place-items-center">
              <p className="font-display italic text-2xl text-muted-foreground">
                Nothing selected.
              </p>
            </div>
          )}
        </div>
      </div>

      <ComposeSheet open={composeOpen} onOpenChange={setComposeOpen} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Left-rail button                                                     */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="eyebrow font-mono text-muted-foreground/60 px-2">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 h-8 px-2 text-sm text-left transition-colors ${
        active
          ? "bg-muted/60 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Thread list row                                                      */
/* ------------------------------------------------------------------ */

function ThreadRow({
  conversation: c,
  active,
  onClick,
}: {
  conversation: Doc<"conversations">;
  active: boolean;
  onClick: () => void;
}) {
  const unread = c.unreadCount > 0;
  const participants = c.participantEmails ?? [];
  const primary = participants[0] ?? "";
  const others = participants.length > 1 ? ` +${participants.length - 1}` : "";
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-4 py-3 border-b border-border transition-colors block ${
          active ? "bg-muted/60" : "hover:bg-muted/30"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate text-sm ${unread ? "font-semibold" : ""}`}>
            {primary}
            {others && (
              <span className="text-muted-foreground font-normal">{others}</span>
            )}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0 num">
            {formatRelative(c.lastMessageAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {c.channel !== "email" && (
            <ChannelChip channel={c.channel} />
          )}
          <p className={`truncate text-sm ${unread ? "text-foreground" : "text-muted-foreground"}`}>
            {c.subject || "(no subject)"}
          </p>
        </div>
        {c.aiSummary && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {c.aiSummary}
          </p>
        )}
      </button>
    </li>
  );
}

function ChannelChip({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.12em] border border-border px-1.5 py-[1px] text-muted-foreground shrink-0">
      {channel === "whatsapp" && <MessageSquare className="size-2.5" />}
      {channel}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Thread reader                                                        */
/* ------------------------------------------------------------------ */

function ThreadReader({ conversationId, onClose }: {
  conversationId: Id<"conversations">;
  onClose: () => void;
}) {
  const data = useQuery(api.emails.getConversation, { id: conversationId });
  const markRead = useMutation(api.emails.markRead);
  const archive = useMutation(api.emails.archive);
  const snooze = useMutation(api.emails.snooze);
  const pin = useMutation(api.emails.pin);
  const unpin = useMutation(api.emails.unpin);
  const draftEmail = useAction(api.aiWorkflows.draftEmailReply);
  const draftWa = useAction(api.aiWorkflows.draftWhatsAppReply);

  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState<string | undefined>();
  const [drafting, setDrafting] = useState(false);

  async function generateDraft() {
    if (!data) return;
    setDrafting(true);
    try {
      const channel = data.conversation.channel;
      const result =
        channel === "whatsapp"
          ? await draftWa({ conversationId })
          : await draftEmail({ conversationId });
      setDraft(result.draft);
      setReplying(true);
      toast.success(`AI draft ready · ${result.provider}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed.");
    } finally {
      setDrafting(false);
    }
  }

  // Mark read on open
  useEffect(() => {
    if (data?.conversation && data.conversation.unreadCount > 0) {
      markRead({ id: conversationId }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, data?.conversation?._id]);

  // Keyboard shortcuts within the reader
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement)?.getAttribute("contenteditable") === "true";
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "r") {
        setReplying(true);
        e.preventDefault();
      } else if (e.key === "e" || e.key === "a") {
        archive({ id: conversationId })
          .then(() => toast.success("Archived."))
          .catch(() => {});
        onClose();
        e.preventDefault();
      } else if (e.key === "s") {
        const until = Date.now() + 1000 * 60 * 60 * 24; // tomorrow
        snooze({ id: conversationId, until })
          .then(() => toast.success("Snoozed until tomorrow."))
          .catch(() => {});
        e.preventDefault();
      } else if (e.key === "#") {
        pin({ id: conversationId }).catch(() => {});
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [conversationId, archive, snooze, pin, onClose]);

  if (!data) return <ThreadReaderSkeleton />;
  const { conversation, messages, contacts, company } = data;

  return (
    <div className="flex flex-col min-h-full">
      {/* Reader header */}
      <div className="border-b border-border px-4 md:px-6 py-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            <button
              onClick={onClose}
              className="md:hidden size-8 grid place-items-center text-muted-foreground hover:text-foreground shrink-0 -ml-1"
              title="Back"
              aria-label="Back to inbox list"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
            <h1 className="font-display italic text-xl md:text-2xl leading-tight truncate">
              {conversation.subject || "(no subject)"}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <ChannelChip channel={conversation.channel} />
              <span>{conversation.messageCount} messages</span>
              {company && (
                <>
                  <span>·</span>
                  <span>{company.name}</span>
                </>
              )}
              {contacts.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {contacts
                      .map((c) => `${c.firstName}${c.lastName ? " " + c.lastName : ""}`)
                      .join(", ")}
                  </span>
                </>
              )}
            </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ReaderButton
              title="Pin"
              onClick={() =>
                conversation.state === "pinned"
                  ? unpin({ id: conversationId })
                  : pin({ id: conversationId })
              }
            >
              <Star className={`size-4 ${conversation.state === "pinned" ? "fill-current" : ""}`} />
            </ReaderButton>
            <ReaderButton title="Snooze (s)" onClick={() => {
              const until = Date.now() + 1000 * 60 * 60 * 24;
              snooze({ id: conversationId, until }).then(() => toast.success("Snoozed."));
            }}>
              <Clock className="size-4" />
            </ReaderButton>
            <ReaderButton title="Archive (e)" onClick={() => {
              archive({ id: conversationId }).then(() => {
                toast.success("Archived.");
                onClose();
              });
            }}>
              <ArchiveIcon className="size-4" />
            </ReaderButton>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 divide-y divide-border">
        {messages.map((m) => (
          <MessageBlock key={m._id} message={m} />
        ))}
      </div>

      {/* Reply bar */}
      <div className="border-t border-border sticky bottom-0 bg-background">
        {replying ? (
          <ReplyBar
            conversationId={conversationId}
            channel={conversation.channel}
            toPhone={
              conversation.channel === "whatsapp"
                ? conversation.participantPhones?.[0]
                : undefined
            }
            initialDraft={draft}
            onSent={() => { setReplying(false); setDraft(undefined); }}
            onCancel={() => { setReplying(false); setDraft(undefined); }}
          />
        ) : (
          <div className="px-6 py-3 flex items-center gap-2">
            <button
              onClick={() => setReplying(true)}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <Reply className="size-3.5" /> Reply
              <span className="text-muted-foreground normal-case tracking-normal text-[10px] ml-1">
                R
              </span>
            </button>
            <button
              onClick={generateDraft}
              disabled={drafting}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              AI draft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReaderButton({
  children, title, onClick,
}: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Message block                                                        */
/* ------------------------------------------------------------------ */

function MessageBlock({
  message: m,
}: {
  message: Doc<"messages"> & { attachments: Doc<"messageAttachments">[] };
}) {
  const [expanded, setExpanded] = useState(true);

  const sender = m.senderName
    ? `${m.senderName} <${m.senderEmail ?? m.senderPhone ?? ""}>`
    : m.senderEmail ?? m.senderPhone ?? "Unknown";

  return (
    <div className="px-6 py-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left flex items-start justify-between gap-4"
      >
        <div className="min-w-0">
          <div className="text-sm">
            <span className={m.direction === "outbound" ? "text-muted-foreground" : "font-medium"}>
              {m.direction === "outbound" ? "You" : sender}
            </span>
            {m.recipientEmails && m.recipientEmails.length > 0 && (
              <span className="text-muted-foreground text-xs ml-2">
                to {m.recipientEmails.join(", ")}
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground num shrink-0">
          {formatRelative(m.sentAt ?? m.receivedAt ?? m._creationTime)}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {m.bodyHtml && m.direction === "inbound" ? (
            <SafeHtml html={m.bodyHtml} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {m.bodyText}
            </pre>
          )}
          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {m.attachments.map((a) => (
                <div
                  key={a._id}
                  className="inline-flex items-center gap-2 h-8 px-3 text-xs border border-border text-muted-foreground"
                >
                  {a.filename}
                  <span className="text-[10px] font-mono">
                    {formatBytes(a.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {m.status === "failed" && (
            <p className="text-xs text-[var(--danger)] font-mono uppercase tracking-[0.12em]">
              Send failed{m.failureReason ? ` — ${m.failureReason}` : ""}
            </p>
          )}
          {m.status === "queued" && (
            <p className="text-xs text-[var(--warning)] font-mono uppercase tracking-[0.12em]">
              Queued — add a Resend key in Settings to send.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sanitized HTML — strip scripts/styles/on* handlers                   */
/* ------------------------------------------------------------------ */

function SafeHtml({ html }: { html: string }) {
  const cleaned = useMemo(() => sanitize(html), [html]);
  return (
    <div
      className="prose prose-sm max-w-none prose-neutral dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />
  );
}

function sanitize(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/* ------------------------------------------------------------------ */
/* Skeletons + utils                                                    */
/* ------------------------------------------------------------------ */

function ThreadListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-full max-w-[220px]" />
          <Skeleton className="h-3 w-full max-w-[280px]" />
        </div>
      ))}
    </div>
  );
}

function ThreadReaderSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-full max-w-md" />
      <Skeleton className="h-4 w-full max-w-sm" />
      <div className="pt-6 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

function EmptyList({
  state, channel, onCompose,
}: { state: StateFilter; channel: ChannelFilter; onCompose: () => void }) {
  const message =
    state === "open"
      ? "Inbox zero."
      : state === "pinned"
        ? "Nothing pinned."
        : state === "snoozed"
          ? "No snoozed threads."
          : "Archive is empty.";
  return (
    <div className="p-8 text-center space-y-3">
      <p className="font-display italic text-xl text-muted-foreground">{message}</p>
      <button
        onClick={onCompose}
        className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline"
      >
        + Compose new
      </button>
    </div>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  if (diff < 24 * 60 * 60_000) {
    return formatDistanceToNowStrict(new Date(ms), { addSuffix: false });
  }
  return new Date(ms).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
