"use client";

import { useState } from "react";
import { useAction } from "convex/react";
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
}: Props) {
  const drafter = useAction(api.coldOutreach.draftColdOutreach);
  const [channel, setChannel] = useState<"email" | "whatsapp">(
    hasEmail ? "email" : "whatsapp",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

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
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
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

        <div className="px-6 py-4 space-y-4">
          <div className="flex gap-1.5">
            <button
              onClick={() => setChannel("email")}
              disabled={!hasEmail}
              className={`h-9 px-4 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${
                channel === "email"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
              } ${!hasEmail && "opacity-40 cursor-not-allowed"}`}
            >
              <Mail className="size-3.5" />
              Email {!hasEmail && "(no address)"}
            </button>
            <button
              onClick={() => setChannel("whatsapp")}
              disabled={!hasPhone}
              className={`h-9 px-4 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${
                channel === "whatsapp"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
              } ${!hasPhone && "opacity-40 cursor-not-allowed"}`}
            >
              <MessageSquare className="size-3.5" />
              WhatsApp {!hasPhone && "(no phone)"}
            </button>
            <div className="ml-auto">
              <Button
                onClick={generate}
                disabled={drafting || !canGenerate}
                size="sm"
                variant={hasContent ? "outline" : "default"}
                className="gap-1.5"
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
              className="resize-none font-normal"
            />
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-3 flex-row items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground italic">
            Review before sending. Cold outreach compliance is on you.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              onClick={sendNow}
              disabled={!hasContent || (channel === "email" && !subject)}
              size="sm"
              className="gap-1.5"
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
