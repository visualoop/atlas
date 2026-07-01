"use client";

import { useState, useTransition, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { Upload, File as FileIcon, FileText, ImageIcon, Trash2, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

interface FilesTabProps {
  relatedToType: string;
  relatedToId: string;
}

export function FilesTab({ relatedToType, relatedToId }: FilesTabProps) {
  const files = useQuery(api.files.listByRelated, { relatedToType, relatedToId });
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const register = useMutation(api.files.register);
  const archive = useMutation(api.files.archive);

  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name}: file is over 50 MB`);
      return;
    }
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await register({
        storageId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        relatedToType,
        relatedToId,
      });
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't upload ${file.name}`);
    }
  }

  function uploadMany(list: FileList | File[]) {
    start(async () => {
      const files = Array.from(list);
      // Upload sequentially so the UI gives ordered toasts and we
      // respect a single 50MB max per file.
      for (const f of files) {
        await uploadOne(f);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) uploadMany(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border border-dashed border-border p-8 text-center cursor-pointer transition-colors",
          dragging && "border-primary bg-primary/5",
          pending && "opacity-60 pointer-events-none",
        )}
      >
        <Upload className="size-5 mx-auto text-muted-foreground" />
        <p className="text-sm mt-2">
          {pending ? "Uploading…" : "Drag files here, or click to pick"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Up to 50 MB each.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) uploadMany(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No files yet.</p>
      ) : (
        <ul className="border border-border divide-y divide-border">
          {files.map((f) => (
            <FileRow key={f._id} file={f} onArchive={() => archive({ id: f._id })} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({
  file,
  onArchive,
}: {
  file: {
    _id: Id<"files">;
    filename: string;
    contentType: string;
    sizeBytes: number;
    _creationTime: number;
  };
  onArchive: () => Promise<unknown>;
}) {
  const url = useQuery(api.files.getUrl, { id: file._id });
  const Icon = iconFor(file.contentType);
  return (
    <li className="px-4 py-3 flex items-center gap-3 group">
      <Icon className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.filename}</p>
        <p className="eyebrow text-[10px] text-muted-foreground mt-0.5 num">
          {formatBytes(file.sizeBytes)} ·{" "}
          {formatDistanceToNow(new Date(file._creationTime), { addSuffix: true })}
        </p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {url && (
          <a
            href={url}
            download={file.filename}
            target="_blank"
            rel="noopener noreferrer"
            title="Download"
            className="size-7 inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Download className="size-3.5" />
          </a>
        )}
        <button
          onClick={onArchive}
          title="Archive"
          className="size-7 inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function iconFor(contentType: string) {
  if (contentType.startsWith("image/")) return ImageIcon;
  if (contentType === "application/pdf" || contentType.includes("text"))
    return FileText;
  return FileIcon;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
