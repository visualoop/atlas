"use client";

import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  Mail, MessageSquare, FileText, Phone, Calendar, Tag,
  Plus, RefreshCw, Trash2, ListTodo, CheckCircle2, Sparkles,
  Building2, User, Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const ICON_BY_TYPE: Record<string, React.ComponentType<{ className?: string }>> = {
  company_created: Building2,
  contact_created: User,
  contact_added_to_company: Plus,
  company_lifecycle_changed: RefreshCw,
  contact_lifecycle_changed: RefreshCw,
  note_added: FileText,
  task_created: ListTodo,
  task_completed: CheckCircle2,
  email_sent: Mail,
  email_received: Mail,
  whatsapp_sent: MessageSquare,
  whatsapp_received: MessageSquare,
  call_logged: Phone,
  meeting_held: Calendar,
  file_uploaded: Upload,
  ai_action: Sparkles,
  tag_added: Tag,
  contact_archived: Trash2,
  company_archived: Trash2,
};

const LABEL_BY_TYPE: Record<string, string> = {
  company_created: "Company created",
  contact_created: "Contact created",
  contact_added_to_company: "Contact added",
  company_lifecycle_changed: "Lifecycle changed",
  contact_lifecycle_changed: "Lifecycle changed",
  note_added: "Note added",
  task_created: "Task created",
  task_completed: "Task completed",
  email_sent: "Email sent",
  email_received: "Email received",
  whatsapp_sent: "WhatsApp sent",
  whatsapp_received: "WhatsApp received",
  call_logged: "Call logged",
  meeting_held: "Meeting held",
  file_uploaded: "File uploaded",
  ai_action: "AI action",
};

export function TimelineFeed({
  events,
  emptyLabel = "No activity yet.",
}: {
  events: Array<{
    _id: Id<"timelineEvents">;
    eventType: string;
    occurredAt: number;
    payload?: unknown;
    actorId?: Id<"users">;
  }>;
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">{emptyLabel}</p>
    );
  }

  return (
    <ol className="space-y-0 -mx-2">
      {events.map((e) => {
        const Icon = ICON_BY_TYPE[e.eventType] ?? Sparkles;
        const label = LABEL_BY_TYPE[e.eventType] ?? e.eventType.replace(/_/g, " ");
        const preview = previewFor(e.eventType, e.payload);
        return (
          <li
            key={e._id}
            className="relative grid grid-cols-[24px_1fr_auto] gap-3 px-2 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-start justify-center pt-0.5">
              <span className="size-6 inline-flex items-center justify-center border border-border bg-background">
                <Icon className="size-3" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm">
                <span className="text-foreground">{label}</span>
                {preview && (
                  <span className="text-muted-foreground">{" · "}{preview}</span>
                )}
              </p>
            </div>
            <p className="text-xs text-muted-foreground whitespace-nowrap pt-0.5 num">
              {formatDistanceToNow(new Date(e.occurredAt), { addSuffix: true })}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function previewFor(type: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (type === "company_created" || type === "contact_created") {
    return (p.name as string) ?? (p.firstName as string) ?? null;
  }
  if (type === "note_added") {
    const preview = p.preview as string | undefined;
    return preview ? `"${preview.slice(0, 80)}${preview.length > 80 ? "…" : ""}"` : null;
  }
  if (type === "task_created" || type === "task_completed") {
    return (p.title as string) ?? null;
  }
  if (type === "company_lifecycle_changed" || type === "contact_lifecycle_changed") {
    return `${p.from} → ${p.to}`;
  }
  if (type === "file_uploaded") {
    return (p.filename as string) ?? null;
  }
  return null;
}

/** Convenience wrapper that fetches events for a subject. */
export function SubjectTimeline({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  // Subject timelines are already on the parent's `get` query in this
  // phase; this component is a fallback for ad-hoc usage. It re-uses
  // contacts.get via a thin pattern only when subject is contact, which
  // is fine for Phase 1; later we'll add a dedicated timeline query.
  return (
    <p className="text-sm text-muted-foreground">
      Use the timeline that comes back from the parent <code>get</code> query.
    </p>
  );
}

void useQuery;
void api;
