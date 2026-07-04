"use client";

import { useState, useEffect } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
  Copy,
  Check,
  Send,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface Props {
  companyId?: Id<"companies">;
  contactId?: Id<"contacts">;
  resultId?: Id<"prospectorResults">;
  companyName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  primaryEmail?: string;
  primaryPhone?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Auto-generate a draft as soon as the dialog opens. */
  autoGenerate?: boolean;
}

/**
 * Cold outreach drafter — AI writes a personalized email or WhatsApp
 * message for a prospect, user reviews, edits, then either:
 *   - Copies to clipboard
 *   - Opens the send flow (compose sheet for email, wa.me for WhatsApp)
 *
 * Never auto-sends. Always human-in-the-loop for cold outreach.
 */
export function OutreachDrafter({
  companyId,
  contactId,
  resultId,
  companyName,
  hasEmail,
  hasPhone,
  primaryEmail,
  primaryPhone,
  open,
  onOpenChange,
  autoGenerate,
}: Props) {
  const drafter = useAction(api.coldOutreach.draftColdOutreach);
  const cachedDraft = useQuery(
    api.coldOutreachQueries.companyAiDraft,
    companyId ? { companyId } : "skip",
  );
  const [channel, setChannel] = useState<"email" | "whatsapp">(
    hasEmail ? "email" : "whatsapp",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [cachedApplied, setCachedApplied] = useState(false);

  // Populate from cached AI draft when it lands (auto-drafted on
  // prospect import). Only fires once so re-generation still works.
  useEffect(() => {
    if (!open || cachedApplied || body || drafting) return;
    if (channel === "email" && cachedDraft?.email) {
      setSubject(cachedDraft.email.subject ?? "");
      setBody(cachedDraft.email.body);
      setCachedApplied(true);
    } else if (channel === "whatsapp" && cachedDraft?.whatsapp) {
      setBody(cachedDraft.whatsapp.body);
      setCachedApplied(true);
    }
  }, [open, cachedDraft, channel, cachedApplied, body, drafting]);

  // Auto-generate on first open when caller asks for it (e.g. Draft
  // deep-link from /today or /outreach/queue). Only fires once per mount.
  useEffect(() => {
    if (!open || !autoGenerate || autoTriggered || body || drafting) return;
    setAutoTriggered(true);
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoGenerate]);

  async function generate() {
    setDrafting(true);
    try {
      const r = await drafter({ companyId, contactId, resultId, channel });
      if (channel === "email") setSubject(r.subject ?? "");
      setBody(r.body);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Draft failed.");
    } finally {
      setDrafting(false);
    }
  }

  function copyToClipboard(what: "subject" | "body") {
    const text = what === "subject" ? subject : body;
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  function sendNow() {
    if (channel === "email") {
      if (!primaryEmail) {
        toast.error("No email address on the contact.");
        return;
      }
      // Open compose sheet with prefill via a query param the inbox listens for
      const url = new URL("/inbox", window.location.origin);
      url.searchParams.set("compose", "1");
      url.searchParams.set("to", primaryEmail);
      url.searchParams.set("subject", subject);
      url.searchParams.set("body", body);
      window.open(url.toString(), "_blank");
    } else {
      const phone = primaryPhone?.replace(/[^\d]/g, "");
      if (!phone) {
        toast.error("No phone number on the contact.");
        return;
      }
      const link = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
      window.open(link, "_blank");
    }
  }

  const canGenerate = channel === "email" ? hasEmail : hasPhone;
  const hasContent = body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl gap-0 p-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5 shrink-0">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            AI · Cold outreach
          </p>
          <DialogTitle className="text-xl font-semibold">
            Draft a message to {companyName}
          </DialogTitle>
          <DialogDescription>
            AI writes the first version using your workspace context + this
            prospect&apos;s data. Review, edit, then send from your inbox
            or WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
              <Button
                type="button"
                size="sm"
                variant={channel === "email" ? "default" : "ghost"}
                onClick={() => setChannel("email")}
                disabled={!hasEmail}
                className="h-8 px-3"
              >
                <Mail className="size-3.5" />
                Email
              </Button>
              <Button
                type="button"
                size="sm"
                variant={channel === "whatsapp" ? "default" : "ghost"}
                onClick={() => setChannel("whatsapp")}
                disabled={!hasPhone}
                className="h-8 px-3"
              >
                <MessageSquare className="size-3.5" />
                WhatsApp
              </Button>
            </div>
            <Button
              onClick={generate}
              disabled={drafting || !canGenerate}
              size="sm"
              variant={hasContent ? "outline" : "default"}
              className="ml-auto"
            >
              {drafting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : hasContent ? (
                <RefreshCw className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {hasContent ? "Regenerate" : "Draft with AI"}
            </Button>
          </div>

          {channel === "email" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Subject</Label>
                {subject && (
                  <button
                    onClick={() => copyToClipboard("subject")}
                    className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    {copied === "subject" ? (
                      <>
                        <Check className="size-2.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-2.5" />
                        Copy
                      </>
                    )}
                  </button>
                )}
              </div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject will appear here after generating…"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{channel === "email" ? "Body" : "Message"}</Label>
              {body && (
                <button
                  onClick={() => copyToClipboard("body")}
                  className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  {copied === "body" ? (
                    <>
                      <Check className="size-2.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-2.5" />
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                canGenerate
                  ? `Click "Draft with AI" to generate a ${channel} message.`
                  : `No ${channel === "email" ? "email address" : "phone number"} on this contact.`
              }
              rows={channel === "email" ? 10 : 5}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="border-t px-4 sm:px-6 py-3 flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
          <p className="text-[11px] text-muted-foreground italic hidden sm:block">
            Review before sending. Cold outreach compliance is on you.
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="flex-1 sm:flex-initial"
            >
              Close
            </Button>
            <Button
              onClick={sendNow}
              disabled={!hasContent || (channel === "email" && !subject)}
              size="sm"
              className="flex-1 sm:flex-initial"
            >
              <Send className="size-3.5" />
              {channel === "email" ? "Open in inbox" : "Open WhatsApp"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
