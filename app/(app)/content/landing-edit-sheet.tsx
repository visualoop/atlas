"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Save, Loader2 } from "lucide-react";
import { NoteEditor } from "@/components/atlas/note-editor";
import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

interface Props {
  page: Doc<"landingPages">;
  onClose: () => void;
}

export function LandingPageEditSheet({ page, onClose }: Props) {
  const update = useMutation(api.content.updateLandingPage);
  const [title, setTitle] = useState(page.title);
  const [subtitle, setSubtitle] = useState(page.subtitle ?? "");
  const [body, setBody] = useState<unknown>(page.body ?? { type: "doc", content: [] });
  const [bodyText, setBodyText] = useState<string>(page.bodyText ?? "");
  const [metaDescription, setMetaDescription] = useState(page.metaDescription ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await update({
        id: page._id,
        patch: {
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          body,
          bodyText,
          metaDescription: metaDescription.trim() || undefined,
        },
      });
      toast.success("Saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="border-b px-4 py-3 shrink-0 space-y-0.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {page.kind.replace("_", " ")}
          </p>
          <SheetTitle className="text-base font-medium truncate">
            /{page.slug}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Edit landing page content
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The clear headline for this page"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Subtitle</Label>
            <Input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Optional one-line context"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <NoteEditor
              initial={body}
              onChange={(json) => {
                setBody(json);
                try {
                  const traverse = (n: unknown): string => {
                    if (typeof n === "string") return n;
                    if (!n || typeof n !== "object") return "";
                    const node = n as { text?: string; content?: unknown[] };
                    if (node.text) return node.text;
                    if (node.content) return node.content.map(traverse).join(" ");
                    return "";
                  };
                  setBodyText(traverse(json).trim());
                } catch {}
              }}
              placeholder="Write the page copy — this renders in the public /p/<workspace>/<slug> route."
              minHeight={340}
            />
          </div>
          <div className="space-y-1.5">
            <Label>SEO meta description</Label>
            <Textarea
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              placeholder="1-2 sentence description for search + social preview"
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <SheetFooter className="border-t px-4 py-3 flex-row items-center gap-2 sm:justify-between shrink-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            {page.status === "published"
              ? "Published · changes live after save"
              : "Draft"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving || title.trim().length === 0}
              size="sm"
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
