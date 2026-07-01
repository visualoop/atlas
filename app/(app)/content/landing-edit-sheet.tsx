"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { X, Save, Loader2 } from "lucide-react";
import { NoteEditor } from "@/components/atlas/note-editor";
import { api } from "@/convex/_generated/api";
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
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/60 backdrop-blur-sm pointer-events-auto"
      />
      <aside
        role="dialog"
        aria-label="Edit landing page"
        className="relative pointer-events-auto bg-background border-l border-border w-full max-w-2xl h-full flex flex-col shadow-2xl"
      >
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="eyebrow font-mono">{page.kind.replace("_", " ")}</p>
            <p className="text-sm font-medium truncate">/{page.slug}</p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-1.5">
            <label className="eyebrow">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The clear headline for this page"
              className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="eyebrow">Subtitle</label>
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Optional one-line context"
              className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="eyebrow">Body</label>
            <NoteEditor
              initial={body}
              onChange={(json) => {
                setBody(json);
                // Extract plaintext
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
            <label className="eyebrow">SEO meta description</label>
            <textarea
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              placeholder="1-2 sentence description for search + social preview"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
            />
          </div>
        </div>

        <footer className="border-t border-border h-14 px-4 flex items-center gap-2 shrink-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            {page.status === "published"
              ? "Published · changes live after save"
              : "Draft"}
          </p>
          <button
            onClick={onClose}
            disabled={saving}
            className="ml-auto text-xs font-mono uppercase tracking-[0.12em] h-9 px-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || title.trim().length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-5 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] disabled:opacity-50 active:scale-[0.97] transition-transform"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}
