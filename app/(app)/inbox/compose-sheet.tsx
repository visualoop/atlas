"use client";

import { useState, useMemo } from "react";
import { useQuery, useAction } from "convex/react";
import { X, Send, Loader2, Sparkles, RefreshCw, Scissors, Plus, Shuffle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { RichComposer } from "@/components/atlas/rich-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ComposeSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Prefill "to" and subject (e.g. from a contact card or draft). */
  prefill?: {
    to?: string[];
    subject?: string;
    bodyHtml?: string;
  };
}

/**
 * Slide-over compose window. Full-width recipient input with pill
 * chips, subject, TipTap body. Sends via `emailsOut.sendNew`.
 */
export function ComposeSheet({ open, onOpenChange, prefill }: ComposeSheetProps) {
  const [to, setTo] = useState<string[]>(prefill?.to ?? []);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(prefill?.bodyHtml ?? "");
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");

  const senderIdentities = useQuery(
    api.emails.listSenderIdentities,
    open ? { channel: "email" } : "skip",
  );
  const [senderIdentityId, setSenderIdentityId] = useState<Id<"senderIdentities"> | undefined>();
  const defaultSender = useMemo(
    () => senderIdentities?.find((s) => s.isDefault) ?? senderIdentities?.[0],
    [senderIdentities],
  );

  const sendNew = useAction(api.emailsOut.sendNew);

  async function handleSend() {
    if (to.length === 0) {
      toast.error("Add at least one recipient.");
      return;
    }
    if (subject.trim().length === 0) {
      const proceed = window.confirm("Send without a subject?");
      if (!proceed) return;
    }
    setSending(true);
    try {
      const result = await sendNew({
        to,
        cc: cc.length ? cc : undefined,
        subject,
        bodyHtml,
        bodyText,
        senderIdentityId: senderIdentityId ?? defaultSender?._id,
      });
      if (result.status === "sent") {
        toast.success("Sent.");
      } else if (result.status === "queued") {
        toast.info("Queued — add a Resend key to send.");
      } else {
        toast.error(`Failed: ${result.error ?? "unknown error"}`);
      }
      onOpenChange(false);
      // Reset form
      setTo([]);
      setCc([]);
      setSubject("");
      setBodyHtml("");
      setBodyText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const noSender = senderIdentities && senderIdentities.length === 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b space-y-1 shrink-0">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Compose
          </p>
          <SheetTitle className="text-xl font-semibold">New message</SheetTitle>
          <SheetDescription className="sr-only">
            Compose a new email
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {noSender && (
            <div className="rounded-md border border-[var(--warning)] p-3 text-xs text-[var(--warning)]">
              <p className="font-medium">No sender identity configured.</p>
              <p className="mt-1 text-muted-foreground">
                Add one in Settings → Sender identities to send email.
              </p>
            </div>
          )}

          <FieldRow label="From">
            {senderIdentities === undefined ? (
              <div className="h-8 flex items-center text-sm text-muted-foreground">Loading…</div>
            ) : senderIdentities.length === 0 ? (
              <div className="h-8 flex items-center text-sm text-muted-foreground">
                No identity available.
              </div>
            ) : (
              <select
                value={senderIdentityId ?? defaultSender?._id}
                onChange={(e) => setSenderIdentityId(e.target.value as Id<"senderIdentities">)}
                className="w-full h-8 text-sm bg-transparent focus:outline-none border-none"
              >
                {senderIdentities.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.displayName ? `${s.displayName} <${s.address}>` : s.address}
                  </option>
                ))}
              </select>
            )}
          </FieldRow>

          <FieldRow label="To" action={
            !showCc && (
              <button
                onClick={() => setShowCc(true)}
                className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                Cc
              </button>
            )
          }>
            <RecipientField
              value={to}
              onChange={setTo}
              inputValue={toInput}
              onInputChange={setToInput}
            />
          </FieldRow>

          {showCc && (
            <FieldRow label="Cc">
              <RecipientField
                value={cc}
                onChange={setCc}
                inputValue={ccInput}
                onInputChange={setCcInput}
              />
            </FieldRow>
          )}

          <FieldRow label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full h-8 text-sm bg-transparent focus:outline-none"
              placeholder="What's this about?"
            />
          </FieldRow>

          <div className="pt-2 space-y-2">
            <AIAssistBar
              subject={subject}
              bodyText={bodyText}
              recipientName={to[0]?.split("@")[0]}
              onDraft={(body) => {
                setBodyHtml(body.replace(/\n/g, "<br>"));
                setBodyText(body);
              }}
            />
            <RichComposer
              initialHtml={bodyHtml}
              placeholder="Write your message…"
              autofocus
              minHeight={280}
              onChange={(v) => {
                setBodyHtml(v.html);
                setBodyText(v.text);
              }}
              onSubmit={handleSend}
              key={bodyHtml.length === 0 ? "empty" : `filled-${bodyText.slice(0, 20)}`}
            />
          </div>
        </div>

        <SheetFooter className="border-t px-6 py-3 flex-row items-center gap-3 sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {noSender ? "Queued — needs sender identity" : ""}
          </span>
          <Button
            onClick={handleSend}
            disabled={sending || to.length === 0}
            size="sm"
            className="gap-2"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Recipient field with contact autocomplete                           */
/* ------------------------------------------------------------------ */

function RecipientField({
  value, onChange, inputValue, onInputChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  inputValue: string;
  onInputChange: (v: string) => void;
}) {
  const search = inputValue.trim();
  const suggestions = useQuery(
    api.contacts.list,
    search.length >= 2 ? { search, limit: 6 } : "skip",
  );

  function commit(email: string) {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    if (!isValidEmail(clean)) return;
    if (value.includes(clean)) return;
    onChange([...value, clean]);
    onInputChange("");
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-1.5 items-center">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 h-7 pl-2 pr-1 text-xs border border-border bg-muted/40"
          >
            {email}
            <button
              onClick={() => onChange(value.filter((v) => v !== email))}
              className="size-5 grid place-items-center text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${email}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              if (isValidEmail(inputValue.trim())) commit(inputValue);
            } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (isValidEmail(inputValue.trim())) commit(inputValue);
          }}
          className="flex-1 min-w-[120px] h-7 text-sm bg-transparent focus:outline-none"
          placeholder={value.length === 0 ? "Add recipient email…" : ""}
        />
      </div>
      {suggestions && suggestions.length > 0 && (
        <ul className="mt-1 border border-border bg-background max-h-40 overflow-y-auto text-sm">
          {suggestions
            .filter((c) => c.email && !value.includes(c.email.toLowerCase()))
            .map((c) => (
              <li key={c._id}>
                <button
                  type="button"
                  onClick={() => c.email && commit(c.email)}
                  className="w-full text-left px-3 py-2 hover:bg-muted flex items-baseline justify-between gap-3"
                >
                  <span>
                    {c.firstName}
                    {c.lastName && ` ${c.lastName}`}
                  </span>
                  <span className="text-xs text-muted-foreground">{c.email}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/* ------------------------------------------------------------------ */
/* FieldRow                                                              */
/* ------------------------------------------------------------------ */

function FieldRow({
  label, children, action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[64px_1fr_auto] gap-3 items-start border-b border-border py-1">
      <span className="eyebrow font-mono text-muted-foreground mt-2">{label}</span>
      <div className="min-w-0">{children}</div>
      <div className="mt-2">{action}</div>
    </div>
  );
}

/* ============================================================ */
/* AIAssistBar — Draft with AI / Improve / Shorter / Longer / etc */
/* ============================================================ */

function AIAssistBar({
  subject,
  bodyText,
  recipientName,
  onDraft,
}: {
  subject: string;
  bodyText: string;
  recipientName?: string;
  onDraft: (body: string) => void;
}) {
  const assist = useAction(api.aiWorkflows.composeAssist);
  const [busy, setBusy] = useState<
    "draft" | "improve" | "shorter" | "longer" | "different_angle" | null
  >(null);
  const [draftHint, setDraftHint] = useState("");
  const [showHint, setShowHint] = useState(false);

  const hasBody = bodyText.trim().length > 0;

  async function run(mode: Exclude<typeof busy, null>, hint?: string) {
    setBusy(mode);
    try {
      const r = await assist({
        mode,
        subject: subject || undefined,
        currentBody: bodyText || undefined,
        hint,
        recipientName,
      });
      onDraft(r.body);
      toast.success(
        mode === "draft"
          ? "AI drafted a first version"
          : mode === "improve"
            ? "Improved"
            : mode === "shorter"
              ? "Tightened"
              : mode === "longer"
                ? "Expanded"
                : "Rewritten from a different angle",
      );
      setShowHint(false);
      setDraftHint("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {!hasBody ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => setShowHint((v) => !v)}
              disabled={disabled}
              className="h-8"
            >
              {busy === "draft" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Draft with AI
            </Button>
            <span className="text-[11px] text-muted-foreground">
              or start typing
            </span>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => run("improve")}
              disabled={disabled}
              className="h-8"
            >
              {busy === "improve" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="hidden sm:inline">Improve</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => run("shorter")}
              disabled={disabled}
              className="h-8"
            >
              {busy === "shorter" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Scissors className="size-3.5" />
              )}
              <span className="hidden sm:inline">Shorter</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => run("longer")}
              disabled={disabled}
              className="h-8"
            >
              {busy === "longer" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              <span className="hidden sm:inline">Longer</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => run("different_angle")}
              disabled={disabled}
              className="h-8"
            >
              {busy === "different_angle" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Shuffle className="size-3.5" />
              )}
              <span className="hidden sm:inline">Different angle</span>
            </Button>
          </>
        )}
      </div>
      {showHint && !hasBody && (
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <Input
            autoFocus
            value={draftHint}
            onChange={(e) => setDraftHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftHint.trim().length >= 3) {
                e.preventDefault();
                void run("draft", draftHint.trim());
              }
            }}
            placeholder="What's this email about?"
            className="flex-1 h-9"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => run("draft", draftHint.trim())}
            disabled={disabled || draftHint.trim().length < 3}
            className="h-9"
          >
            {busy === "draft" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Draft
          </Button>
        </div>
      )}
    </div>
  );
}
