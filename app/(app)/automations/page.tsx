"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Plus, Play, Pause, Zap, Trash2, ChevronRight, Loader2, X,
  Mail, Bot, Link2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";

type TriggerType = "timeline_event" | "scheduler" | "webhook" | "manual";
type NodeKind = "native" | "composio" | "ai";

interface FlowNode {
  id: string;
  kind: NodeKind;
  action?: string;
  connectionId?: Id<"composioConnections">;
  args?: Record<string, unknown>;
  prompt?: string;
  model?: string;
}

export default function AutomationsPage() {
  const automations = useQuery(api.automationEngineHelpers.listAutomations, {});
  const [activeId, setActiveId] = useState<Id<"automations"> | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const active = automations?.find((a) => a._id === activeId) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="eyebrow">Automations</p>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-1">
            Ship rules that <em className="italic">run themselves</em>.
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-prose">
            Trigger → nodes → outputs. Native actions, Composio-connected apps,
            AI-generated content. All journalled.
          </p>
        </div>
        <Button
          onClick={() => setNewOpen(true)}
          className="h-9 text-xs font-mono uppercase tracking-[0.12em]"
        >
          <Plus className="size-3.5" /> New
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 md:gap-6">
        <aside className="space-y-2">
          {automations === undefined ? (
            <>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</>
          ) : automations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic border border-dashed border-border p-4">
              Nothing here yet. Create one.
            </p>
          ) : (
            <ul className="border border-border divide-y divide-border">
              {automations.map((a) => (
                <li key={a._id}>
                  <button
                    onClick={() => setActiveId(a._id)}
                    className={cn(
                      "w-full text-left px-3 py-3 hover:bg-muted/40 transition-colors",
                      activeId === a._id && "bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium flex-1 truncate">{a.name}</p>
                      {a.active ? (
                        <span className="eyebrow text-[10px] text-[var(--success)]">Live</span>
                      ) : (
                        <span className="eyebrow text-[10px] text-muted-foreground">Off</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.triggerType} · {a.runCount} runs
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section>
          {active ? (
            <AutomationDetail automation={active} />
          ) : (
            <div className="border border-dashed border-border py-20 text-center">
              <p className="font-display italic text-2xl text-muted-foreground">
                Nothing selected.
              </p>
            </div>
          )}
        </section>
      </div>

      {newOpen && <NewAutomationDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

/* ============================================================ */

function AutomationDetail({ automation: a }: { automation: Doc<"automations"> }) {
  const update = useMutation(api.automationEngineHelpers.updateAutomation);
  const archive = useMutation(api.automationEngineHelpers.archiveAutomation);
  const runNow = useAction(api.automationEngine.runAutomationManually);
  const runs = useQuery(api.automationEngineHelpers.listRuns, { automationId: a._id, limit: 10 });

  const [nodes, setNodes] = useState<FlowNode[]>(
    (a.nodes ?? []).map((n) => n as FlowNode),
  );
  const [saving, setSaving] = useState(false);

  async function toggleActive() {
    await update({ id: a._id, patch: { active: !a.active } });
    toast.success(a.active ? "Paused." : "Live.");
  }

  async function saveNodes() {
    setSaving(true);
    try {
      await update({ id: a._id, patch: { nodes } });
      toast.success("Saved.");
    } finally {
      setSaving(false);
    }
  }

  function addNode(kind: NodeKind) {
    const node: FlowNode = {
      id: crypto.randomUUID(),
      kind,
      action: kind === "native" ? "send_email" : undefined,
      args: {},
    };
    setNodes((n) => [...n, node]);
  }

  function updateNode(id: string, patch: Partial<FlowNode>) {
    setNodes((n) => n.map((nd) => (nd.id === id ? { ...nd, ...patch } : nd)));
  }

  function removeNode(id: string) {
    setNodes((n) => n.filter((nd) => nd.id !== id));
  }

  async function trigger() {
    try {
      await runNow({ automationId: a._id, payload: {} });
      toast.success("Queued. See runs below.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{a.triggerType}</p>
          <h2 className="font-display italic text-3xl mt-1">{a.name}</h2>
          {a.description && (
            <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={trigger}
            className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
          >
            <Play className="size-3" /> Run now
          </Button>
          <Button
            size="sm"
            onClick={toggleActive}
            className={cn(
              "h-8 text-xs font-mono uppercase tracking-[0.12em]",
              a.active && "bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30",
            )}
          >
            {a.active ? <><Pause className="size-3" /> Pause</> : <><Zap className="size-3" /> Activate</>}
          </Button>
        </div>
      </header>

      {/* Nodes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Flow</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => addNode("native")} title="Add native action"
              className="h-7 text-xs font-mono uppercase tracking-[0.12em]">
              <Mail className="size-3" /> Native
            </Button>
            <Button variant="outline" size="sm" onClick={() => addNode("composio")} title="Add Composio action"
              className="h-7 text-xs font-mono uppercase tracking-[0.12em]">
              <Link2 className="size-3" /> Composio
            </Button>
            <Button variant="outline" size="sm" onClick={() => addNode("ai")} title="Add AI node"
              className="h-7 text-xs font-mono uppercase tracking-[0.12em]">
              <Bot className="size-3" /> AI
            </Button>
          </div>
        </div>

        {nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic border border-dashed border-border p-4">
            No steps yet — add one above.
          </p>
        ) : (
          <div className="space-y-2">
            {nodes.map((node, i) => (
              <NodeCard
                key={node.id}
                node={node}
                index={i}
                onChange={(patch) => updateNode(node.id, patch)}
                onRemove={() => removeNode(node.id)}
              />
            ))}
          </div>
        )}
        {nodes.length > 0 && (
          <Button
            onClick={saveNodes}
            disabled={saving}
            className="h-9 px-5 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save flow
          </Button>
        )}
      </section>

      {/* Runs */}
      <section className="space-y-2">
        <p className="eyebrow">Recent runs</p>
        {runs === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No runs yet.</p>
        ) : (
          <div className="border border-border divide-y divide-border">
            {runs.map((r) => (
              <div key={r._id} className="px-4 py-3 flex items-center gap-3">
                <RunPill status={r.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                    {r.finishedAt && ` · ${r.finishedAt - r.startedAt}ms`}
                  </p>
                  {r.error && (
                    <p className="text-xs text-[var(--destructive)]">{r.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="pt-4 border-t border-border">
        <Button
          variant="link"
          onClick={async () => {
            if (!confirm("Archive automation?")) return;
            await archive({ id: a._id });
            toast.success("Archived.");
          }}
          className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em] text-[var(--destructive)]"
        >
          <Trash2 className="size-3" /> Archive
        </Button>
      </div>
    </div>
  );
}

function RunPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: "text-[var(--success)] border-[var(--success)]",
    failed: "text-[var(--destructive)] border-[var(--destructive)]",
    partial: "text-[var(--warning)] border-[var(--warning)]",
    pending: "text-muted-foreground border-border",
    running: "text-[var(--info)] border-[var(--info)]",
  };
  return (
    <span className={cn(
      "text-[10px] font-mono uppercase tracking-[0.12em] border px-1.5 py-[1px] shrink-0",
      styles[status] ?? "border-border text-muted-foreground",
    )}>
      {status}
    </span>
  );
}

function NodeCard({
  node, index, onChange, onRemove,
}: {
  node: FlowNode;
  index: number;
  onChange: (patch: Partial<FlowNode>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="eyebrow text-[10px] text-muted-foreground">
          {index + 1}. {node.kind}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 hover:text-[var(--destructive)]"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {node.kind === "native" && (
        <div className="space-y-2">
          <Select
            value={node.action ?? "send_email"}
            onValueChange={(v) => v && onChange({ action: v })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="send_email">Send email</SelectItem>
              <SelectItem value="add_tag">Add tag to contact</SelectItem>
              <SelectItem value="wait">Wait</SelectItem>
            </SelectContent>
          </Select>
          {node.action === "send_email" && (
            <>
              <Input
                placeholder="To (comma-separated emails)"
                value={((node.args?.to as string[]) ?? []).join(", ")}
                onChange={(e) => onChange({
                  args: { ...node.args, to: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) },
                })}
              />
              <Input
                placeholder="Subject"
                value={(node.args?.subject as string) ?? ""}
                onChange={(e) => onChange({ args: { ...node.args, subject: e.target.value } })}
              />
              <Textarea
                placeholder="Body (plain text)"
                rows={3}
                value={(node.args?.text as string) ?? ""}
                onChange={(e) => onChange({
                  args: {
                    ...node.args,
                    text: e.target.value,
                    html: e.target.value.replace(/\n/g, "<br/>"),
                  },
                })}
                className="resize-none"
              />
            </>
          )}
        </div>
      )}
      {node.kind === "ai" && (
        <div className="space-y-2">
          <Input
            placeholder="Model (default llama-3.3-70b-versatile)"
            value={node.model ?? ""}
            onChange={(e) => onChange({ model: e.target.value })}
            className="font-mono"
          />
          <Textarea
            placeholder="Prompt — output stored on the run"
            rows={3}
            value={node.prompt ?? ""}
            onChange={(e) => onChange({ prompt: e.target.value })}
            className="resize-none"
          />
        </div>
      )}
      {node.kind === "composio" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Configure Composio connection at{" "}
            <a href="/settings/integrations" className="text-primary underline">
              Settings → Integrations
            </a>{" "}
            first.
          </p>
          <Input
            placeholder="Action (e.g. slack.postMessage)"
            value={node.action ?? ""}
            onChange={(e) => onChange({ action: e.target.value })}
            className="font-mono"
          />
          <Textarea
            placeholder='Params JSON: {"channel":"#general","text":"hi"}'
            rows={3}
            value={JSON.stringify(node.args ?? {}, null, 2)}
            onChange={(e) => {
              try {
                onChange({ args: JSON.parse(e.target.value) });
              } catch {}
            }}
            className="text-xs font-mono resize-none"
          />
        </div>
      )}
    </div>
  );
}

/* ============================================================ */

function NewAutomationDialog({ onClose }: { onClose: () => void }) {
  const create = useMutation(api.automationEngineHelpers.createAutomation);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("manual");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (name.trim().length < 2) {
      toast.error("Name required.");
      return;
    }
    setSaving(true);
    try {
      await create({
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType,
        triggerConfig: triggerType === "scheduler" ? { cron: "0 9 * * *" } : {},
        nodes: [],
      });
      toast.success("Created.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/60 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-md shadow-2xl">
        <header className="px-6 py-4 border-b border-border">
          <p className="eyebrow font-mono">Automation</p>
          <h2 className="font-display italic text-2xl mt-1">New flow.</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <Input
            autoFocus
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder="Optional description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-none"
          />
          <Select
            value={triggerType}
            onValueChange={(v) => v && setTriggerType(v as TriggerType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual trigger (button)</SelectItem>
              <SelectItem value="scheduler">Scheduler (cron)</SelectItem>
              <SelectItem value="timeline_event">Timeline event</SelectItem>
              <SelectItem value="webhook">Incoming webhook</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <footer className="px-6 py-3 border-t border-border flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="ml-auto h-8 text-xs font-mono uppercase tracking-[0.12em]"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || name.trim().length === 0}
            className="h-8 px-5 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create
          </Button>
        </footer>
      </div>
    </div>
  );
}
