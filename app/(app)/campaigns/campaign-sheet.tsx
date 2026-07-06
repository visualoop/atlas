"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  X, Play, Pause, Plus, Trash2, Loader2, Mail, MessageSquare, Users,
  ChevronRight,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface Props {
  campaignId: Id<"campaigns">;
  onClose: () => void;
}

const LIFECYCLE_OPTIONS = ["cold", "warm", "qualified", "customer", "lost"] as const;

export function CampaignSheet({ campaignId, onClose }: Props) {
  const data = useQuery(api.campaigns.getCampaign, { id: campaignId });
  const launch = useMutation(api.campaigns.launch);
  const pause = useMutation(api.campaigns.pause);
  const resume = useMutation(api.campaigns.resume);
  const enroll = useMutation(api.campaigns.enrollAudience);
  const addStep = useMutation(api.campaigns.addStep);
  const removeStep = useMutation(api.campaigns.removeStep);

  const [audienceOpen, setAudienceOpen] = useState(false);
  const [selectedStages, setSelectedStages] = useState<string[]>(["cold", "warm"]);
  const [busy, setBusy] = useState(false);

  if (data === undefined) {
    return (
      <SheetShell onClose={onClose}>
        <div className="p-8 space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </SheetShell>
    );
  }
  if (data === null) {
    return (
      <SheetShell onClose={onClose}>
        <div className="p-8 text-center text-muted-foreground italic">Campaign not found.</div>
      </SheetShell>
    );
  }

  const { campaign, steps, recipients } = data;
  const isRunning = campaign.status === "running";
  const isPaused = campaign.status === "paused";
  const canEdit = campaign.status === "draft" || campaign.status === "paused";

  async function handleLaunch() {
    setBusy(true);
    try {
      await launch({ id: campaignId });
      toast.success("Launched.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseResume() {
    setBusy(true);
    try {
      if (isRunning) {
        await pause({ id: campaignId });
        toast.success("Paused.");
      } else if (isPaused) {
        await resume({ id: campaignId });
        toast.success("Resumed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEnroll(dryRun: boolean) {
    setBusy(true);
    try {
      const res = await enroll({
        campaignId,
        filter: {
          lifecycleStages: selectedStages.length ? selectedStages : undefined,
          hasEmail: campaign.channel === "email" || campaign.channel === "multi",
          hasWhatsapp: campaign.channel === "whatsapp" || campaign.channel === "multi",
        },
        dryRun,
      });
      if (dryRun) {
        toast.info(`Would enroll ${res.matched} contacts.`);
      } else {
        toast.success(`Enrolled ${res.enrolled} of ${res.matched}.`);
        setAudienceOpen(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddStep(template?: {
    subject: string;
    bodyText?: string;
    bodyHtml: string;
  }) {
    const channel = campaign.channel === "whatsapp" ? "whatsapp" : "email";
    const subject =
      channel === "email" ? template?.subject ?? "New step subject" : undefined;
    const bodyText =
      channel === "email" ? template?.bodyText ?? "New step body." : undefined;
    const bodyHtml =
      channel === "email"
        ? template?.bodyHtml ?? "<p>New step body.</p>"
        : undefined;

    await addStep({
      campaignId,
      delayHours: steps.length === 0 ? 0 : 24,
      channel,
      subject,
      bodyText,
      bodyHtml,
      templateName: channel === "whatsapp" ? "" : undefined,
      templateLanguage: channel === "whatsapp" ? "en" : undefined,
    });
  }

  return (
    <SheetShell onClose={onClose}>
      <div className="p-6 md:p-8 space-y-6">
        <header className="space-y-1">
          <p className="eyebrow font-mono text-muted-foreground">Campaign</p>
          <h2 className="font-display italic text-3xl leading-tight">{campaign.name}</h2>
          {campaign.description && (
            <p className="text-sm text-muted-foreground">{campaign.description}</p>
          )}
        </header>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {campaign.status === "draft" && (
            <button
              onClick={handleLaunch}
              disabled={busy || steps.length === 0 || campaign.recipientCount === 0}
              title={
                steps.length === 0 ? "Add steps first"
                  : campaign.recipientCount === 0 ? "Enroll audience first"
                    : "Launch"
              }
              className={cn(
                "inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Launch
            </button>
          )}
          {isRunning && (
            <button
              onClick={handlePauseResume}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-[var(--warning)] hover:text-[var(--warning)] transition-colors"
            >
              <Pause className="size-3.5" /> Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={handlePauseResume}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
            >
              <Play className="size-3.5" /> Resume
            </button>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3" />
              {campaign.recipientCount} recipients
            </span>
            <span className="font-mono num">Sent: {campaign.sentCount}</span>
            <span className="font-mono num">Replies: {campaign.replyCount}</span>
          </span>
        </div>

        {/* Steps */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">Sequence</p>
            {canEdit && campaign.channel !== "whatsapp" && (
              <StepTemplatePicker onPick={handleAddStep} />
            )}
            {canEdit && campaign.channel === "whatsapp" && (
              <button
                onClick={() => handleAddStep()}
                className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline inline-flex items-center gap-1"
              >
                <Plus className="size-3.5" /> Add step
              </button>
            )}
          </div>
          {steps.length === 0 ? (
            <div className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No steps yet. Add the first message to start.
            </div>
          ) : (
            <ol className="border border-border divide-y divide-border">
              {steps.map((s, i) => (
                <StepRow
                  key={s._id}
                  step={s}
                  index={i}
                  canEdit={canEdit}
                  onRemove={() => removeStep({ id: s._id })}
                />
              ))}
            </ol>
          )}
        </section>

        {/* Audience */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">Audience</p>
            {canEdit && (
              <button
                onClick={() => setAudienceOpen(!audienceOpen)}
                className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline"
              >
                {audienceOpen ? "Close" : "Enroll contacts"}
              </button>
            )}
          </div>

          {audienceOpen && canEdit && (
            <div className="border border-border p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Pick which lifecycle stages to enroll. Contacts already in the campaign are skipped.
              </p>
              <div className="flex flex-wrap gap-1">
                {LIFECYCLE_OPTIONS.map((stage) => {
                  const active = selectedStages.includes(stage);
                  return (
                    <button
                      key={stage}
                      onClick={() =>
                        setSelectedStages((prev) =>
                          prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
                        )
                      }
                      className={cn(
                        "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
                        active
                          ? "bg-foreground text-background"
                          : "border border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {stage}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => handleEnroll(true)}
                  disabled={busy}
                  className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
                >
                  Preview
                </button>
                <button
                  onClick={() => handleEnroll(false)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
                  Enroll
                </button>
              </div>
            </div>
          )}

          {recipients.length > 0 && (
            <div className="mt-3 border border-border p-3 space-y-1">
              <p className="text-xs text-muted-foreground mb-2">
                {recipients.length} recipient{recipients.length === 1 ? "" : "s"} preview
                {recipients.length >= 200 && " (first 200 shown)"}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-xs">
                {(["pending", "sent", "replied", "converted", "opted_out", "completed", "failed", "paused"] as const).map((state) => {
                  const count = recipients.filter((r) => r.state === state).length;
                  if (count === 0) return null;
                  return (
                    <div key={state} className="flex items-center justify-between px-2 py-1 bg-muted/30">
                      <span className="text-muted-foreground capitalize">{state.replace("_", " ")}</span>
                      <span className="font-mono num">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground italic">
          Campaign runner ticks every minute — pending recipients get emails
          via your Resend key + WhatsApp via your Meta connection. Ensure
          the org has senders + connections set at Settings → Integrations.
        </p>
      </div>
    </SheetShell>
  );
}

/* ------------------------------------------------------------------ */

function StepRow({
  step, index, canEdit, onRemove,
}: {
  step: Doc<"campaignSteps">;
  index: number;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
          Step {index + 1}
        </span>
        <span className="text-xs text-muted-foreground">
          {step.channel === "email" ? <Mail className="size-3 inline" /> : <MessageSquare className="size-3 inline" />}
          {" "}
          {step.channel}
        </span>
        <span className="text-xs text-muted-foreground">
          {step.delayHours === 0 ? "Immediately" : `+${step.delayHours}h`}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
        {canEdit && (
          <button
            onClick={onRemove}
            className="size-6 grid place-items-center text-muted-foreground hover:text-[var(--danger)]"
            title="Remove"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="text-xs bg-muted/30 p-3 space-y-1 border border-border">
          {step.channel === "email" && (
            <>
              <p className="font-medium">{step.subject ?? "(no subject)"}</p>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {step.bodyText ?? "(no body)"}
              </p>
            </>
          )}
          {step.channel === "whatsapp" && (
            <>
              <p className="font-mono">Template: {step.templateName ?? "(not set)"}</p>
              {step.templateVariables?.length && (
                <p className="text-muted-foreground">
                  Vars: {step.templateVariables.join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function SheetShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 overflow-y-auto"
      >
        <SheetTitle className="sr-only">Campaign detail</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}


/* ============================================================ */
/* StepTemplatePicker — dropdown for adding a step from a       */
/* seeded email template                                          */
/* ============================================================ */

function StepTemplatePicker({
  onPick,
}: {
  onPick: (template?: {
    subject: string;
    bodyText?: string;
    bodyHtml: string;
  }) => void | Promise<void>;
}) {
  const templates = useQuery(api.emailTemplates.list, {});
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-mono uppercase tracking-[0.12em] text-primary hover:underline inline-flex items-center gap-1"
      >
        <Plus className="size-3.5" /> Add step
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 border border-border bg-background shadow-lg divide-y divide-border max-h-96 overflow-y-auto">
            <button
              onClick={async () => {
                setOpen(false);
                await onPick();
              }}
              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
            >
              <p className="text-xs font-medium">Blank step</p>
              <p className="text-[10px] text-muted-foreground">
                Empty subject + body, write from scratch
              </p>
            </button>
            {templates === undefined ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Loading templates…
              </div>
            ) : templates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No templates yet.
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t._id}
                  onClick={async () => {
                    setOpen(false);
                    await onPick({
                      subject: t.subject,
                      bodyText: t.bodyText,
                      bodyHtml: t.bodyHtml,
                    });
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                >
                  <p className="text-xs font-medium">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-[0.10em]">
                    {t.category.replace(/_/g, " ")}
                  </p>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
