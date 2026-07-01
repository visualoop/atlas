"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Send, X, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RichComposer } from "@/components/atlas/rich-composer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReplyBarProps {
  conversationId: Id<"conversations">;
  onSent: () => void;
  onCancel: () => void;
}

export function ReplyBar({ conversationId, onSent, onCancel }: ReplyBarProps) {
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
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
      <RichComposer
        placeholder="Type your reply… ⌘↵ to send"
        autofocus
        minHeight={140}
        onChange={(v) => {
          setHtml(v.html);
          setText(v.text);
        }}
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
