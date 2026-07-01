"use client";

import { useState, useTransition } from "react";
import { useQuery, useMutation } from "convex/react";
import { Pin, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NoteEditor } from "./note-editor";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

interface NotesTabProps {
  relatedToType: string;
  relatedToId: string;
}

export function NotesTab({ relatedToType, relatedToId }: NotesTabProps) {
  const notes = useQuery(api.notes.listByRelated, {
    relatedToType,
    relatedToId,
  });
  const createNote = useMutation(api.notes.create);
  const archiveNote = useMutation(api.notes.archive);
  const updateNote = useMutation(api.notes.update);

  const [draft, setDraft] = useState<unknown>(null);
  const [pending, start] = useTransition();
  // bump key to force a fresh editor instance after submit
  const [editorKey, setEditorKey] = useState(0);

  function submit() {
    if (!draft || isEmptyDoc(draft)) {
      toast.error("Write something first.");
      return;
    }
    start(async () => {
      try {
        await createNote({
          body: draft,
          relatedToType,
          relatedToId,
        });
        setDraft(null);
        setEditorKey((k) => k + 1);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save note");
      }
    });
  }

  const pinned = (notes ?? []).filter((n) => n.pinned);
  const unpinned = (notes ?? []).filter((n) => !n.pinned);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="eyebrow">New note</p>
        <NoteEditor key={editorKey} onChange={setDraft} onSubmit={submit} />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending} size="sm">
            {pending ? "…" : "Save note"}
          </Button>
        </div>
      </section>

      {pinned.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow flex items-center gap-1.5">
            <Pin className="size-3" /> Pinned
          </p>
          <ul className="space-y-3">
            {pinned.map((n) => (
              <NoteRow
                key={n._id}
                note={n}
                onArchive={(id) => archiveNote({ id })}
                onTogglePin={(id, pinned) => updateNote({ id, patch: { pinned } })}
              />
            ))}
          </ul>
        </section>
      )}

      {unpinned.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow">All notes</p>
          <ul className="space-y-3">
            {unpinned.map((n) => (
              <NoteRow
                key={n._id}
                note={n}
                onArchive={(id) => archiveNote({ id })}
                onTogglePin={(id, pinned) => updateNote({ id, patch: { pinned } })}
              />
            ))}
          </ul>
        </section>
      )}

      {notes !== undefined && notes.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No notes yet for this record.
        </p>
      )}
    </div>
  );
}

function NoteRow({
  note,
  onArchive,
  onTogglePin,
}: {
  note: {
    _id: Id<"notes">;
    body: unknown;
    bodyText: string;
    title?: string;
    pinned: boolean;
    _creationTime: number;
  };
  onArchive: (id: Id<"notes">) => Promise<unknown>;
  onTogglePin: (id: Id<"notes">, pinned: boolean) => Promise<unknown>;
}) {
  return (
    <li className="border border-border p-4 group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {note.title && <p className="font-medium mb-1">{note.title}</p>}
          <NoteRenderer body={note.body} />
          <p className="eyebrow text-muted-foreground mt-2 text-[10px]">
            {formatDistanceToNow(new Date(note._creationTime), { addSuffix: true })}
          </p>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onTogglePin(note._id, !note.pinned)}
            title={note.pinned ? "Unpin" : "Pin"}
            className="size-7 inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Pin className={`size-3.5 ${note.pinned ? "text-primary" : ""}`} />
          </button>
          <button
            onClick={() => onArchive(note._id)}
            title="Archive"
            className="size-7 inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

/** Render TipTap JSON as styled HTML (read-only). */
function NoteRenderer({ body }: { body: unknown }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1.5 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic [&_h2]:font-display [&_h2]:text-xl [&_a]:underline [&_a]:text-primary">
      {renderTipTap(body)}
    </div>
  );
}

function renderTipTap(node: unknown, key = 0): React.ReactNode {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: string; text?: string; content?: unknown[]; marks?: Array<{ type: string; attrs?: { href?: string } }>; attrs?: { level?: number; href?: string } };

  if (n.type === "text") {
    let text: React.ReactNode = n.text ?? "";
    for (const mark of n.marks ?? []) {
      if (mark.type === "bold") text = <strong key={`b${key}`}>{text}</strong>;
      else if (mark.type === "italic") text = <em key={`i${key}`}>{text}</em>;
      else if (mark.type === "link") text = <a key={`a${key}`} href={mark.attrs?.href} target="_blank" rel="noopener noreferrer">{text}</a>;
    }
    return text;
  }

  const children = (n.content ?? []).map((c, i) => renderTipTap(c, i));

  switch (n.type) {
    case "doc": return <>{children}</>;
    case "paragraph": return <p key={key}>{children}</p>;
    case "heading": {
      const level = n.attrs?.level ?? 2;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      if (level === 3) return <h3 key={key}>{children}</h3>;
      return <h4 key={key}>{children}</h4>;
    }
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "hardBreak": return <br key={key} />;
    default: return <>{children}</>;
  }
}

function isEmptyDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return true;
  const d = doc as { type?: string; content?: Array<{ type?: string; content?: unknown[] }> };
  if (d.type !== "doc") return false;
  if (!d.content || d.content.length === 0) return true;
  if (d.content.length === 1) {
    const only = d.content[0];
    if (only.type === "paragraph" && (!only.content || only.content.length === 0)) return true;
  }
  return false;
}
