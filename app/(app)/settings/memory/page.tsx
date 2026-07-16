"use client";

/**
 * Settings → Memory
 *
 * Browse, add, and forget Atlas long-term facts.
 *
 * Read from api.workspaceKnowledge.list.
 * Write via api.workspaceKnowledge.remember.
 * Soft-delete via api.workspaceKnowledge.forget.
 */

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { formatDistanceToNowStrict } from "date-fns";
import { Sparkles, Trash2, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const SUBJECT_TYPES = [
  { value: "workspace", label: "Workspace-global" },
  { value: "contact", label: "Contact" },
  { value: "company", label: "Company" },
  { value: "deal", label: "Deal" },
] as const;

type SubjectType = (typeof SUBJECT_TYPES)[number]["value"];

const SOURCE_LABELS: Record<string, string> = {
  message_extraction: "Extracted from message",
  meeting_note: "Meeting note",
  manual: "Added manually",
  prospector_enrichment: "Prospector enrichment",
};

export default function MemoryPage() {
  const [subjectType, setSubjectType] = useState<SubjectType | "all">("all");
  const facts = useQuery(
    api.workspaceKnowledge.list,
    subjectType === "all"
      ? { limit: 100 }
      : { subjectType, limit: 100 },
  );
  const remember = useMutation(api.workspaceKnowledge.remember);
  const forget = useMutation(api.workspaceKnowledge.forget);

  const [addOpen, setAddOpen] = useState(false);
  const [newSubjectType, setNewSubjectType] = useState<SubjectType>("workspace");
  const [newSubjectId, setNewSubjectId] = useState("");
  const [newFact, setNewFact] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (newFact.trim().length < 5) {
      toast.error("Fact must be at least 5 characters.");
      return;
    }
    setSaving(true);
    try {
      await remember({
        subjectType: newSubjectType,
        subjectId: newSubjectId.trim() || undefined,
        fact: newFact.trim(),
      });
      toast.success("Fact saved to memory.");
      setNewFact("");
      setNewSubjectId("");
      setAddOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleForget(id: Id<"workspaceKnowledge">) {
    if (!confirm("Forget this fact? Atlas will stop referencing it in future AI turns.")) return;
    try {
      await forget({ id });
      toast.success("Forgotten.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">
          <Sparkles className="size-3 inline mr-1 text-primary" />
          Long-term memory
        </p>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every fact Atlas knows about your workspace, contacts, companies,
          and deals. Facts are extracted automatically from inbound emails
          + added manually from Copilot chats. Every AI feature reads from
          this table before drafting.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-2 justify-between border border-border p-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
            Filter
          </Label>
          <Select
            value={subjectType}
            onValueChange={(v) => setSubjectType(v as SubjectType | "all")}
          >
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All facts</SelectItem>
              {SUBJECT_TYPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setAddOpen((v) => !v)} variant={addOpen ? "outline" : "default"}>
          <Plus className="size-3.5" />
          {addOpen ? "Cancel" : "Add fact"}
        </Button>
      </section>

      {addOpen && (
        <section className="border border-border p-6 space-y-4">
          <p className="eyebrow">Add fact</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select
                value={newSubjectType}
                onValueChange={(v) => setNewSubjectType(v as SubjectType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newSubjectType !== "workspace" && (
              <div className="space-y-1.5">
                <Label>Record id</Label>
                <Input
                  value={newSubjectId}
                  onChange={(e) => setNewSubjectId(e.target.value)}
                  placeholder="jd7abc123..."
                  className="font-mono"
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Fact</Label>
            <Textarea
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="Prefers WhatsApp over email for quick questions."
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={saving} size="sm">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Save fact
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        {facts === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : facts.length === 0 ? (
          <div className="border border-dashed border-border p-10 text-center space-y-2">
            <p className="font-display italic text-lg text-muted-foreground">
              No facts yet.
            </p>
            <p className="text-sm text-muted-foreground max-w-prose mx-auto">
              Atlas builds this up automatically as you get inbound emails.
              You can also add facts manually or via Copilot ("remember that
              Kimton prefers WhatsApp").
            </p>
          </div>
        ) : (
          facts.map((f) => (
            <article
              key={f._id}
              className="border border-border p-4 space-y-2 group hover:border-foreground/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm leading-relaxed flex-1">{f.fact}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleForget(f._id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  aria-label="Forget"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                <Badge variant="outline" className="text-[9px] capitalize">
                  {f.subjectType}
                </Badge>
                <span>·</span>
                <span>{SOURCE_LABELS[f.source] ?? f.source}</span>
                <span>·</span>
                <span>Confidence {f.confidence}</span>
                <span>·</span>
                <span>
                  {formatDistanceToNowStrict(f.lastVerifiedAt, { addSuffix: true })}
                </span>
                {f.subjectId && (
                  <>
                    <span>·</span>
                    <span className="font-mono truncate max-w-[240px]">
                      {f.subjectId}
                    </span>
                  </>
                )}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
