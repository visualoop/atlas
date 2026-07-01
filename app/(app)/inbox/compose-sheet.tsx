"use client";

import { useState, useMemo } from "react";
import { useQuery, useAction } from "convex/react";
import { X, Paperclip, Send, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { RichComposer } from "@/components/atlas/rich-composer";
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-end pointer-events-none">
      <div
        onClick={() => !sending && onOpenChange(false)}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div
        role="dialog"
        aria-label="Compose email"
        className="relative pointer-events-auto bg-background border border-border w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col shadow-2xl"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="eyebrow font-mono text-muted-foreground">Compose</p>
            <h2 className="font-display italic text-2xl leading-none mt-1">New message.</h2>
          </div>
          <button
            onClick={() => !sending && onOpenChange(false)}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {noSender && (
            <div className="border border-[var(--warning)] p-3 text-xs text-[var(--warning)]">
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

          <div className="pt-2">
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
            />
          </div>
        </div>

        <footer className="border-t border-border px-6 py-3 flex items-center gap-3">
          <button
            type="button"
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Attach (coming soon)"
            disabled
          >
            <Paperclip className="size-4" />
          </button>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {noSender ? "Queued — needs sender identity" : ""}
          </span>
          <button
            onClick={handleSend}
            disabled={sending || to.length === 0}
            className={cn(
              "inline-flex items-center gap-2 h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
            )}
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </button>
        </footer>
      </div>
    </div>
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
