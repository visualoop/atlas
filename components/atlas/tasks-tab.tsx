"use client";

import { useState, useTransition } from "react";
import { useQuery, useMutation } from "convex/react";
import { Calendar, Trash2, ListTodo } from "lucide-react";
import { formatDistanceToNow, isPast } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PRIORITY_STYLES: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-[var(--warning)]",
  urgent: "text-[var(--danger)]",
};

interface TasksTabProps {
  relatedToType: string;
  relatedToId: string;
}

export function TasksTab({ relatedToType, relatedToId }: TasksTabProps) {
  const tasks = useQuery(api.tasks.listByRelated, {
    relatedToType,
    relatedToId,
    includeCompleted: true,
  });
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const archiveTask = useMutation(api.tasks.archive);

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    start(async () => {
      try {
        await createTask({
          title,
          relatedToType,
          relatedToId,
          priority,
          dueAt: due ? new Date(due).getTime() : undefined,
        });
        setTitle("");
        setDue("");
        setPriority("normal");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't create task");
      }
    });
  }

  const open = (tasks ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled");
  const completed = (tasks ?? []).filter((t) => t.status === "done");

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-2">
        <p className="eyebrow">New task</p>
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Follow up on Karen proposal…"
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="max-w-[160px]"
          />
          <div className="flex gap-0.5">
            {(["low", "normal", "high", "urgent"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "font-mono uppercase tracking-[0.12em] text-[10px] px-2 py-1 border transition-colors",
                  priority === p
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={pending || !title.trim()} className="ml-auto">
            {pending ? "…" : "Add"}
          </Button>
        </div>
      </form>

      {open.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow">Open · {open.length}</p>
          <ul className="border border-border divide-y divide-border">
            {open.map((t) => (
              <TaskRow
                key={t._id}
                task={t}
                onComplete={() => updateTask({ id: t._id, patch: { status: "done" } })}
                onArchive={() => archiveTask({ id: t._id })}
              />
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow text-muted-foreground">Done · {completed.length}</p>
          <ul className="border border-border divide-y divide-border">
            {completed.map((t) => (
              <TaskRow
                key={t._id}
                task={t}
                onComplete={() => updateTask({ id: t._id, patch: { status: "open" } })}
                onArchive={() => archiveTask({ id: t._id })}
              />
            ))}
          </ul>
        </section>
      )}

      {tasks !== undefined && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground italic flex items-center gap-2">
          <ListTodo className="size-4" />
          No tasks yet for this record.
        </p>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onComplete,
  onArchive,
}: {
  task: {
    _id: Id<"tasks">;
    title: string;
    status: string;
    priority: string;
    dueAt?: number;
    aiSuggested: boolean;
  };
  onComplete: () => void;
  onArchive: () => void;
}) {
  const done = task.status === "done";
  const overdue = task.dueAt && !done && isPast(new Date(task.dueAt));

  return (
    <li className="px-4 py-3 flex items-center gap-3 group">
      <button
        type="button"
        onClick={onComplete}
        className={cn(
          "size-4 border-2 shrink-0 transition-colors",
          done ? "bg-primary border-primary" : "border-border-strong hover:border-primary",
        )}
        aria-label={done ? "Reopen" : "Complete"}
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm leading-tight",
            done && "line-through text-muted-foreground",
            !done && PRIORITY_STYLES[task.priority],
          )}
        >
          {task.title}
          {task.aiSuggested && (
            <span className="eyebrow ml-2 text-[10px] text-primary">★ AI</span>
          )}
        </p>
        {task.dueAt && (
          <p
            className={cn(
              "eyebrow text-[10px] mt-1 flex items-center gap-1",
              overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Calendar className="size-2.5" />
            {overdue ? "Overdue · " : "Due "}
            {formatDistanceToNow(new Date(task.dueAt), { addSuffix: true })}
          </p>
        )}
      </div>
      <button
        onClick={onArchive}
        className="size-7 inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Archive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
