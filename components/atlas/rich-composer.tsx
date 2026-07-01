"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

interface RichComposerProps {
  initialHtml?: string;
  placeholder?: string;
  autofocus?: boolean;
  minHeight?: number;
  onChange?: (v: { html: string; text: string }) => void;
  onSubmit?: () => void;
}

/**
 * Rich email/reply composer. Emits BOTH HTML (for delivery) and
 * plain text (for the DB / search / preview) on every change.
 * Cmd/Ctrl+Enter triggers onSubmit.
 */
export function RichComposer({
  initialHtml,
  placeholder = "Write your message…",
  autofocus = false,
  minHeight = 160,
  onChange,
  onSubmit,
}: RichComposerProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "underline text-primary" },
      }),
    ],
    content: initialHtml ?? "",
    autofocus: autofocus ? "end" : false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none",
          "[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_.is-editor-empty:first-child::before]:text-muted-foreground",
          "[&_.is-editor-empty:first-child::before]:float-left",
          "[&_.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.is-editor-empty:first-child::before]:h-0",
          "[&_p]:my-2 [&_p]:leading-relaxed",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic",
        ),
        style: `min-height: ${minHeight}px`,
      },
      handleKeyDown(_, e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          onSubmit?.();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange?.({
        html: editor.getHTML(),
        text: editor.getText(),
      });
    },
  });

  useEffect(() => {
    if (editor && initialHtml !== undefined) {
      const current = editor.getHTML();
      if (current !== initialHtml) {
        editor.commands.setContent(initialHtml ?? "", { emitUpdate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return <div style={{ minHeight }} />;

  return (
    <div className="border border-border focus-within:border-foreground transition-colors">
      <div className="border-b border-border px-2 py-1 flex items-center gap-1 bg-[var(--surface)]">
        <ToolButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="Bold"
        >
          <Bold className="size-3.5" />
        </ToolButton>
        <ToolButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="Italic"
        >
          <Italic className="size-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Bullets"
        >
          <List className="size-3.5" />
        </ToolButton>
        <ToolButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Numbered"
        >
          <ListOrdered className="size-3.5" />
        </ToolButton>
        <ToolButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Quote"
        >
          <Quote className="size-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          active={editor.isActive("link")}
          onClick={() => {
            const url = window.prompt("URL");
            if (!url) return;
            editor.chain().focus().toggleLink({ href: url }).run();
          }}
          label="Link"
        >
          <LinkIcon className="size-3.5" />
        </ToolButton>
        <span className="ml-auto eyebrow text-[10px] text-muted-foreground hidden sm:inline">
          ⌘↵ to send
        </span>
      </div>
      <div className="px-3 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolButton({
  children, onClick, active, label,
}: {
  children: React.ReactNode; onClick: () => void; active?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "size-7 inline-flex items-center justify-center transition-colors",
        "hover:bg-muted",
        active && "bg-muted text-foreground",
        !active && "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-border mx-0.5" />;
}
