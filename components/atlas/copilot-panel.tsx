"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "convex/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import {
  Sparkles,
  Send,
  X,
  Trash2,
  KeyRound,
  Loader2,
  Plus,
  History,
  Wrench,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Multi-thread persistence keys. Per-thread UIMessage[] is stored in
 * localStorage so a chat survives reloads and can be resumed from
 * the History drawer.
 */
const CURRENT_KEY = "atlas_copilot_current"; // { threadId, messages }
const HISTORY_KEY = "atlas_copilot_history"; // Thread[]
const HISTORY_MAX = 20;

interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
}

/**
 * Pretty labels for tool-status pills. Falls back to the raw name if
 * we haven't mapped it.
 */
const TOOL_LABEL: Record<string, string> = {
  workspace_snapshot: "Loading workspace snapshot",
  workspace_kpis: "Checking pipeline KPIs",
  search_contacts: "Searching contacts",
  search_companies: "Searching companies",
  search_deals: "Searching deals",
  list_deals: "Listing deals",
  list_recent_conversations: "Reading recent conversations",
  list_recent_messages: "Reading recent messages",
  list_recent_activity: "Reading recent activity",
  list_tasks: "Listing tasks",
};

export function CopilotPanel({ open, onOpenChange }: Props) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<Thread[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const preflight = useQuery(
    api.copilotHelpers.canRun,
    open ? {} : "skip",
  );
  const workspaceInfo = useQuery(
    api.copilotHelpers.workspaceBrandInfo,
    open ? {} : "skip",
  );

  // Reflect preflight into needsSetup so open+empty shows the right state
  useEffect(() => {
    if (preflight?.reason === "no_ai_key") setNeedsSetup(true);
    else if (preflight?.ready) setNeedsSetup(false);
  }, [preflight]);

  // Load history + current thread on mount (only once)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialLoaded) return;
    try {
      const historyRaw = window.localStorage.getItem(HISTORY_KEY);
      if (historyRaw) setHistory(JSON.parse(historyRaw) as Thread[]);
    } catch {}
    try {
      const raw = window.localStorage.getItem(CURRENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          threadId: string;
          messages: UIMessage[];
        };
        if (parsed.threadId && Array.isArray(parsed.messages)) {
          setThreadId(parsed.threadId);
          setInitialMessages(parsed.messages);
        }
      }
    } catch {}
    setInitialLoaded(true);
  }, [initialLoaded]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
  } = useChat({
    id: threadId ?? undefined,
    messages: initialMessages,
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: "/api/copilot",
        }),
      [],
    ),
    onFinish() {
      // Message list is committed to UI state — persist it below
    },
    onError(err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed.error?.toLowerCase().includes("no ai provider")) {
          setNeedsSetup(true);
          return;
        }
        toast.error(parsed.error ?? raw);
      } catch {
        toast.error(raw);
      }
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Persist thread + upsert into history on every message change
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!threadId) return;
    if (!initialLoaded) return;
    window.localStorage.setItem(
      CURRENT_KEY,
      JSON.stringify({ threadId, messages }),
    );
    if (messages.length === 0) return;
    setHistory((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId);
      const firstUser = messages.find((m) => m.role === "user");
      const title =
        firstUser?.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join(" ")
          .slice(0, 60) ?? "New chat";
      const entry: Thread = {
        id: threadId,
        title,
        updatedAt: Date.now(),
        messages,
      };
      const next =
        idx >= 0
          ? [...prev.slice(0, idx), entry, ...prev.slice(idx + 1)]
          : [entry, ...prev];
      const trimmed = next
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, HISTORY_MAX);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      } catch {}
      return trimmed;
    });
  }, [messages, threadId, initialLoaded]);

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, status]);

  async function send() {
    const text = input.trim();
    if (!text || isBusy) return;
    if (!threadId) setThreadId(crypto.randomUUID());
    setInput("");
    await sendMessage({ text });
  }

  function clearThread() {
    if (!confirm("Clear conversation history?")) return;
    setMessages([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_KEY);
    }
  }

  function newChat() {
    setMessages([]);
    setInput("");
    setThreadId(crypto.randomUUID());
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_KEY);
    }
    inputRef.current?.focus();
  }

  const brandEmpty = workspaceInfo && !workspaceInfo.hasContext;

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
          <p className="text-sm font-medium">{workspaceInfo?.assistantName ?? "Atlas"}</p>
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground px-2 py-0.5 border border-border rounded">
            ⌘J
          </span>
          <button
            onClick={() => setHistoryOpen(true)}
            title="History"
            className="ml-auto size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
          >
            <History className="size-3.5" />
          </button>
          <button
            onClick={newChat}
            title="New chat"
            className="size-8 grid place-items-center text-muted-foreground hover:text-primary hover:bg-muted transition-colors rounded"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={clearThread}
            disabled={messages.length === 0}
            title="Clear thread"
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 rounded"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 relative"
        >
          {historyOpen && (
            <HistoryOverlay
              history={history}
              activeThreadId={threadId}
              onSelectThread={(t) => {
                setThreadId(t.id);
                setMessages(t.messages);
                setHistoryOpen(false);
                setTimeout(() => {
                  scrollerRef.current?.scrollTo({
                    top: scrollerRef.current.scrollHeight,
                    behavior: "instant",
                  });
                }, 50);
              }}
              onClose={() => setHistoryOpen(false)}
              onClearAll={() => {
                if (!confirm("Clear all chat history? Cannot be undone.")) return;
                setHistory([]);
                try {
                  window.localStorage.removeItem(HISTORY_KEY);
                } catch {}
              }}
            />
          )}

          {needsSetup ? (
            <SetupPrompt onClose={() => onOpenChange(false)} />
          ) : messages.length === 0 ? (
            <EmptyState
              onSuggest={(prompt) => {
                setInput(prompt);
                inputRef.current?.focus();
              }}
              brandEmpty={brandEmpty}
            />
          ) : (
            <>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {isBusy && <ThinkingIndicator status={status} />}
            </>
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
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none rounded"
            disabled={isBusy && status !== "streaming"}
          />
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            <span>Enter to send · Shift+Enter for newline</span>
            {isBusy ? (
              <button
                onClick={() => stop()}
                className="inline-flex items-center gap-1.5 h-7 px-3 border border-border hover:border-destructive hover:text-destructive transition-colors rounded"
              >
                <X className="size-3" />
                Stop
              </button>
            ) : (
              <button
                onClick={send}
                disabled={input.trim().length === 0}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform rounded",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <Send className="size-3" />
                Send
              </button>
            )}
          </div>
          {error && (
            <p className="text-[11px] text-destructive">
              {error instanceof Error ? error.message : "Something went wrong."}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ============================================================ */
/* Message bubble — renders text + tool parts                    */
/* ============================================================ */

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "size-6 grid place-items-center rounded shrink-0 mt-0.5",
          isUser ? "bg-muted" : "bg-primary/10 text-primary",
        )}
      >
        {isUser ? (
          <span className="text-[10px] font-mono">You</span>
        ) : (
          <Sparkles className="size-3.5" />
        )}
      </span>
      <div className="flex-1 min-w-0 space-y-1.5">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p
                key={i}
                className="text-sm whitespace-pre-wrap break-words leading-relaxed"
              >
                {part.text}
              </p>
            );
          }
          if (part.type.startsWith("tool-")) {
            return <ToolPart key={i} part={part} />;
          }
          if (part.type === "reasoning" && "text" in part) {
            return (
              <details
                key={i}
                className="text-[11px] text-muted-foreground italic"
              >
                <summary className="cursor-pointer hover:text-foreground">
                  Reasoning
                </summary>
                <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
              </details>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

/**
 * Render an AI SDK v5 tool-* UIMessage part.
 *
 * Each tool has 3 states rendered as chips:
 *   - input-streaming / input-available: "Calling X…" with spinner
 *   - output-available: "Read X (n results)" with green check
 *   - output-error: "Failed to X" with red alert
 */
function ToolPart({ part }: { part: UIMessage["parts"][number] }) {
  // AI SDK v5 encodes tool parts as `tool-<toolName>` with a `state` field
  const p = part as {
    type: string;
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const toolName = p.type.replace(/^tool-/, "");
  const label = TOOL_LABEL[toolName] ?? toolName.replace(/_/g, " ");
  const running =
    p.state === "input-streaming" || p.state === "input-available";
  const ok = p.state === "output-available";
  const failed = p.state === "output-error";

  let resultSummary: string | null = null;
  if (ok && p.output) {
    resultSummary = summarizeToolOutput(p.output);
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border font-mono w-fit max-w-full",
        running &&
          "border-primary/40 bg-primary/5 text-primary",
        ok && "border-emerald-600/30 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400",
        failed && "border-destructive/40 bg-destructive/5 text-destructive",
      )}
    >
      {running && <Loader2 className="size-3 animate-spin shrink-0" />}
      {ok && <CheckCircle2 className="size-3 shrink-0" />}
      {failed && <AlertCircle className="size-3 shrink-0" />}
      <span className="truncate">{label}</span>
      {resultSummary && (
        <span className="opacity-60 truncate">· {resultSummary}</span>
      )}
      {failed && p.errorText && (
        <span className="opacity-60 truncate">· {p.errorText}</span>
      )}
    </div>
  );
}

function summarizeToolOutput(output: unknown): string {
  if (Array.isArray(output)) {
    return `${output.length} result${output.length === 1 ? "" : "s"}`;
  }
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.messages))
      return `${(o.messages as unknown[]).length} messages`;
    if (Array.isArray(o.topDeals))
      return `${(o.topDeals as unknown[]).length} deals`;
    if (o.pipelineTotalCents) return `pipeline snapshot`;
    return "done";
  }
  return "done";
}

/* ============================================================ */
/* Auxiliary components                                          */
/* ============================================================ */

function ThinkingIndicator({ status }: { status: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="size-6 grid place-items-center bg-primary/10 text-primary rounded shrink-0 mt-0.5">
        <Sparkles className="size-3.5 animate-pulse" />
      </span>
      <div className="flex-1 pt-1 space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
          <Loader2 className="size-3 animate-spin" />
          {status === "submitted" ? "Thinking…" : "Composing response…"}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onSuggest,
  brandEmpty,
}: {
  onSuggest: (prompt: string) => void;
  brandEmpty: boolean | undefined;
}) {
  const suggestions = [
    "What should I do today?",
    "Who did I speak to yesterday?",
    "Summarise my top 3 open deals",
    "What's my pipeline value?",
  ];
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center space-y-5 max-w-xs">
        <div className="size-14 mx-auto grid place-items-center bg-primary/10 rounded-full">
          <Sparkles className="size-6 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="font-display italic text-2xl">Ask anything.</p>
          <p className="text-sm text-muted-foreground">
            The Copilot can read your workspace + take actions.
          </p>
        </div>
        {brandEmpty && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-left text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            <p className="font-medium mb-0.5">Missing workspace context</p>
            <p className="opacity-80">
              Answers will be generic until you fill out{" "}
              <Link
                href="/settings/workspace"
                className="underline hover:no-underline"
              >
                Settings → Workspace
              </Link>
              .
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggest(s)}
              className="w-full text-left px-3 py-2 text-xs border border-border hover:border-foreground hover:bg-muted transition-colors rounded"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center space-y-4 max-w-xs">
        <KeyRound className="size-8 text-primary mx-auto" />
        <p className="font-display italic text-2xl">Set up an AI key.</p>
        <p className="text-sm text-muted-foreground">
          Copilot needs a Groq, Gemini, Cerebras, OpenAI, or OpenRouter key.
          Groq + Gemini both have generous free tiers.
        </p>
        <div className="pt-2 space-y-2">
          <Link
            href="/settings/integrations"
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] active:scale-[0.97] rounded"
            onClick={onClose}
          >
            <KeyRound className="size-3.5" />
            Open Integrations
          </Link>
          <p className="text-[11px] text-muted-foreground italic">
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Get a free Groq key
            </a>{" "}
            (30 req/min, no card).
          </p>
        </div>
      </div>
    </div>
  );
}

function HistoryOverlay({
  history,
  activeThreadId,
  onSelectThread,
  onClose,
  onClearAll,
}: {
  history: Thread[];
  activeThreadId: string | null;
  onSelectThread: (t: Thread) => void;
  onClose: () => void;
  onClearAll: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 bg-background flex flex-col">
      <div className="flex items-center px-3 h-11 border-b border-border">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          Chat history
        </p>
        <button
          onClick={onClose}
          className="ml-auto size-8 grid place-items-center text-muted-foreground hover:text-foreground rounded"
          aria-label="Close history"
        >
          <X className="size-4" />
        </button>
      </div>
      {history.length === 0 ? (
        <div className="flex-1 grid place-items-center px-6 text-center">
          <div className="space-y-2">
            <History className="size-8 text-muted-foreground mx-auto" />
            <p className="font-display italic text-xl text-muted-foreground">
              No past chats yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Every chat you have with the Copilot is saved on this device.
              Up to {HISTORY_MAX} threads.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {history.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectThread(t)}
              className={cn(
                "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors block",
                activeThreadId === t.id && "bg-muted/60",
              )}
            >
              <p className="text-sm font-medium truncate">{t.title}</p>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {t.messages.length} msgs · {new Date(t.updatedAt).toLocaleString()}
              </p>
            </button>
          ))}
          <button
            onClick={onClearAll}
            className="w-full text-left px-4 py-3 text-xs font-mono uppercase tracking-[0.12em] text-destructive hover:bg-muted/40 transition-colors"
          >
            <Trash2 className="size-3 inline mr-1.5" />
            Clear all history
          </button>
        </div>
      )}
    </div>
  );
}
