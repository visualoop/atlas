"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            New campaign
          </p>
          <DialogTitle className="text-xl font-semibold">
            What are you reaching out about?
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a new outbound campaign.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Omnix — March demo push"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-baseline gap-2">
              Description
              <span className="text-muted-foreground/60 text-[10px] font-normal">optional</span>
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why does this exist?"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Channel</Label>
            <div className="flex gap-1.5">
              {(["email", "whatsapp", "multi"] as const).map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={cn(
                    "h-9 px-4 rounded-md text-sm font-medium transition-colors capitalize",
                    channel === ch
                      ? "bg-primary text-primary-foreground"
                      : "border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-3 flex-row items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => !saving && onClose()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} size="sm" className="gap-1.5">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
