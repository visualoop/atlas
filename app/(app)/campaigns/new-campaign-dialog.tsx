"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { X, Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onCreated: (id: Id<"campaigns">) => void;
}

export function NewCampaignDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp" | "multi">("email");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.campaigns.createCampaign);

  async function submit() {
    if (name.trim().length < 3) {
      toast.error("Give it a name.");
      return;
    }
    setSaving(true);
    try {
      const id = await create({
        name: name.trim(),
        description: description.trim() || undefined,
        channel,
      });
      toast.success("Created.");
      onCreated(id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border flex items-start justify-between">
          <div>
            <p className="eyebrow font-mono text-muted-foreground">New campaign</p>
            <h2 className="font-display italic text-2xl mt-1">What are you <em>reaching out</em> about?</h2>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Omnix — March demo push"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Description <span className="normal-case tracking-normal text-muted-foreground/60">— optional</span>
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why does this exist?"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Channel</span>
            <div className="flex gap-1">
              {(["email", "whatsapp", "multi"] as const).map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={cn(
                    "h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] transition-colors capitalize",
                    channel === ch
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
