"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Send, X, Loader2, MessageSquare, Mail, AlertTriangle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RichComposer } from "@/components/atlas/rich-composer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReplyBarProps {
  conversationId: Id<"conversations">;
  channel: "email" | "whatsapp" | "sms" | "call" | "social_comment";
  toPhone?: string;
  initialDraft?: string;                                        // AI-generated pre-fill
  onSent: () => void;
  onCancel: () => void;
}

export function ReplyBar({
  conversationId, channel, toPhone, initialDraft, onSent, onCancel,
}: ReplyBarProps) {
  if (channel === "whatsapp") {
    return (
      <WhatsAppReplyBar
        conversationId={conversationId}
        toPhone={toPhone ?? ""}
        initialDraft={initialDraft}
        onSent={onSent}
        onCancel={onCancel}
      />
    );
  }
  return (
    <EmailReplyBar
      conversationId={conversationId}
      initialDraft={initialDraft}
      onSent={onSent}
      onCancel={onCancel}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Email reply                                                          */
/* ------------------------------------------------------------------ */

function EmailReplyBar({
  conversationId, initialDraft, onSent, onCancel,
}: {
  conversationId: Id<"conversations">;
  initialDraft?: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [html, setHtml] = useState(initialDraft ? toHtml(initialDraft) : "");
  const [text, setText] = useState(initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const sendReply = useAction(api.emailsOut.sendReply);

  async function handleSend() {
    if (text.trim().length === 0) {
      toast.error("Reply is empty.");
      return;
    }
    setSending(true);
    try {
      const result = await sendReply({
        conversationId,
        bodyHtml: html,
        bodyText: text,
      });
      if (result.status === "sent") toast.success("Reply sent.");
      else if (result.status === "queued") toast.info("Queued — add a Resend key to send.");
      else toast.error(`Failed: ${result.error ?? "unknown error"}`);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        <Mail className="size-3" />
        Reply by email
      </div>
      <RichComposer
        initialHtml={html}
        placeholder="Type your reply… ⌘↵ to send"
        autofocus
        minHeight={140}
        onChange={(v) => { setHtml(v.html); setText(v.text); }}
        onSubmit={handleSend}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={sending || text.trim().length === 0}
          className={cn(
            "inline-flex items-center gap-2 h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          )}
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Reply
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="inline-flex items-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Convert plain text with newlines to minimal HTML for the editor. */
function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */
/* WhatsApp reply — 24h window aware                                    */
/* ------------------------------------------------------------------ */

function WhatsAppReplyBar({
  conversationId, toPhone, initialDraft, onSent, onCancel,
}: {
  conversationId: Id<"conversations">;
  toPhone: string;
  initialDraft?: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const canFree = useQuery(api.whatsapp.canReplyFree, { conversationId });
  const templates = useQuery(api.whatsapp.listTemplates, { onlyApproved: true });
  const [templateName, setTemplateName] = useState<string>("");
  const sendText = useAction(api.whatsappOut.sendText);
  const sendTemplate = useAction(api.whatsappOut.sendTemplate);

  async function handleSend() {
    if (text.trim().length === 0) {
      toast.error("Message is empty.");
      return;
    }
    setSending(true);
    try {
      if (canFree) {
        const r = await sendText({
          conversationId,
          toPhone,
          bodyText: text,
        });
        if (r.status === "sent") toast.success("Sent.");
        else if (r.status === "queued") toast.info("Queued — configure WhatsApp to send.");
        else toast.error(`Failed: ${r.error ?? "unknown error"}`);
        onSent();
      } else {
        if (!templateName) {
          toast.error("Pick a template — you're outside the 24-hour window.");
          return;
        }
        const r = await sendTemplate({
          conversationId,
          toPhone,
          templateName,
          variables: text.split("|").map((s) => s.trim()).filter(Boolean),
        });
        if (r.status === "sent") toast.success("Template sent.");
        else toast.error(`Failed: ${r.error ?? "unknown error"}`);
        onSent();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        <MessageSquare className="size-3" />
        Reply by WhatsApp
        <span className="ml-auto">
          {canFree === undefined ? "" : canFree ? "Within 24h window" : "Outside 24h — template only"}
        </span>
      </div>

      {canFree === false && (
        <div className="flex items-start gap-2 border border-[var(--warning)] p-3 text-xs">
          <AlertTriangle className="size-4 text-[var(--warning)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[var(--warning)] font-medium">Outside the 24-hour service window.</p>
            <p className="text-muted-foreground">
              Meta requires an approved template message. Pick a template below —
              use <code className="font-mono text-[10px]">|</code> to separate variable values
              (mapped positionally to <code className="font-mono text-[10px]">{'{{1}}'}</code>,{" "}
              <code className="font-mono text-[10px]">{'{{2}}'}</code>, …).
            </p>
          </div>
        </div>
      )}

      {canFree === false && (
        <div className="space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
            Template
          </span>
          <select
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
          >
            <option value="">— Pick a template —</option>
            {templates?.map((t) => (
              <option key={t._id} value={t.name}>
                {t.name} ({t.language}) — {t.category}
              </option>
            ))}
          </select>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSend();
        }}
        placeholder={
          canFree
            ? "Type your message… ⌘↵ to send"
            : "Values for template variables — separate with |"
        }
        rows={4}
        autoFocus
        className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={sending || text.trim().length === 0}
          className={cn(
            "inline-flex items-center gap-2 h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="inline-flex items-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}
