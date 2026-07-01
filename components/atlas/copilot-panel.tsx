"use client";

import { useState, useEffect, useRef } from "react";
import { useAction } from "convex/react";
import { Sparkles, Send, X, Loader2, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STORAGE_KEY = "atlas_copilot_thread";

export function CopilotPanel({ open, onOpenChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = useAction(api.copilot.chat);

  // Load persisted thread
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setMessages(JSON.parse(raw));
      } catch {}
    }
  }, []);

  // Persist thread
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;

    const newUserMsg: Message = { role: "user", content: text, timestamp: Date.now() };
    const nextMessages = [...messages, newUserMsg];
    setMessages(nextMessages);
    setInput("");
    setPending(true);

    try {
      const result = await chat({
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.reply,
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
      // Roll back the user message so they can retry
    } finally {
      setPending(false);
    }
  }

  function clearThread() {
    if (!confirm("Clear conversation history?")) return;
    setMessages([]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-background/40 backdrop-blur-sm pointer-events-auto"
      />
      <aside
        role="dialog"
        aria-label="AI Copilot"
        className="relative pointer-events-auto bg-background border-l border-border w-full max-w-md h-full flex flex-col shadow-2xl"
      >
        <header className="h-12 border-b border-border flex items-center px-3 gap-2 shrink-0">
          <Sparkles className="size-4 text-primary" />
          <p className="text-sm font-medium">Copilot</p>
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground px-2 py-0.5 border border-border">
            ⌘J
          </span>
          <button
            onClick={clearThread}
            disabled={messages.length === 0}
            title="Clear thread"
            className="ml-auto size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 && !pending && (
            <div className="h-full grid place-items-center">
              <div className="text-center space-y-4 max-w-xs">
                <Sparkles className="size-8 text-primary mx-auto" />
                <p className="font-display italic text-2xl text-muted-foreground">
                  Ask me anything.
                </p>
                <p className="text-sm text-muted-foreground">
                  I have access to your contacts, companies, deals, and inbox.
                  Web search + code execution are built in.
                </p>
                <div className="space-y-1.5 text-left pt-2">
                  <SuggestedPrompt text="Who did I speak to yesterday?" onClick={setInput} />
                  <SuggestedPrompt text="Summarise my top 3 open deals" onClick={setInput} />
                  <SuggestedPrompt text="What's my cash runway?" onClick={setInput} />
                  <SuggestedPrompt text="Find coffee shops in Nairobi worth prospecting" onClick={setInput} />
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBlock key={i} message={m} />
          ))}

          {pending && (
            <div className="flex items-start gap-3">
              <span className="size-6 grid place-items-center bg-primary/10 text-primary rounded-none shrink-0">
                <Sparkles className="size-3.5" />
              </span>
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-2.5 bg-muted rounded-none animate-pulse w-3/4" />
                <div className="h-2.5 bg-muted rounded-none animate-pulse w-1/2" />
                <div className="h-2.5 bg-muted rounded-none animate-pulse w-2/3" />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 space-y-2 shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask a question or give an instruction…"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
            disabled={pending}
          />
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            <span>Enter to send · Shift+Enter for newline</span>
            <button
              onClick={send}
              disabled={pending || input.trim().length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              Send
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MessageBlock({ message: m }: { message: Message }) {
  if (m.role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="max-w-[80%] px-3 py-2 bg-primary text-primary-foreground text-sm whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <span className="size-6 grid place-items-center bg-primary/10 text-primary shrink-0">
        <Sparkles className="size-3.5" />
      </span>
      <div className="flex-1 min-w-0 text-sm">
        <div
          className="prose prose-sm max-w-none prose-neutral dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: linkifyIds(escapeHtml(m.content)) }}
        />
      </div>
    </div>
  );
}

function SuggestedPrompt({
  text, onClick,
}: { text: string; onClick: (v: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="block w-full text-left text-xs px-3 py-2 border border-border hover:border-foreground hover:bg-muted/50 transition-colors"
    >
      {text}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}

/**
 * Turn [contact:xxx] / [deal:xxx] / [company:xxx] references into
 * clickable links to the corresponding Atlas surface.
 */
function linkifyIds(html: string): string {
  return html
    .replace(/\[contact:([a-z0-9]{20,})\]/gi, (_m, id) =>
      `<a href="/contacts?open=${id}" class="text-primary underline">contact:${String(id).slice(0, 6)}…</a>`,
    )
    .replace(/\[company:([a-z0-9]{20,})\]/gi, (_m, id) =>
      `<a href="/companies?open=${id}" class="text-primary underline">company:${String(id).slice(0, 6)}…</a>`,
    )
    .replace(/\[deal:([a-z0-9]{20,})\]/gi, (_m, id) =>
      `<a href="/pipelines" class="text-primary underline">deal:${String(id).slice(0, 6)}…</a>`,
    );
}
