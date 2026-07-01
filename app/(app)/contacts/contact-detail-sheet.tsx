"use client";

import { useQuery, useMutation } from "convex/react";
import { Mail, Phone, MessageSquare, Trash2 } from "lucide-react";
import { RecordSheet } from "@/components/atlas/record-sheet";
import { TimelineFeed } from "@/components/atlas/timeline-feed";
import { NotesTab } from "@/components/atlas/notes-tab";
import { TasksTab } from "@/components/atlas/tasks-tab";
import { FilesTab } from "@/components/atlas/files-tab";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

export function ContactDetailSheet({
  contactId,
  open,
  onOpenChange,
}: {
  contactId: Id<"contacts">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useQuery(api.contacts.get, { id: contactId });
  const archive = useMutation(api.contacts.archive);

  if (!data) {
    return (
      <RecordSheet
        open={open}
        onOpenChange={onOpenChange}
        eyebrow="Contact"
        title="Loading…"
        initials="…"
        tabs={[{ id: "timeline", label: "Timeline", content: <p className="text-sm text-muted-foreground">Loading…</p> }]}
      />
    );
  }

  const { contact, company, timeline } = data;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const initials = fullName.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  async function handleArchive() {
    try {
      await archive({ id: contactId });
      toast.success("Contact archived.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive");
    }
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={`Contact · ${contact.lifecycleStage}`}
      title={fullName}
      subtitle={contact.title || company?.name || undefined}
      initials={initials || "?"}
      actions={
        <>
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center h-8 px-4 text-xs border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <Mail className="size-3.5 mr-1.5" /> Email
            </a>
          )}
          {contact.whatsapp && (
            <a
              href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center h-8 px-4 text-xs border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <MessageSquare className="size-3.5 mr-1.5" /> WhatsApp
            </a>
          )}
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="inline-flex items-center h-8 px-4 text-xs border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <Phone className="size-3.5 mr-1.5" /> Call
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={handleArchive}>
            <Trash2 className="size-3.5 mr-1.5" /> Archive
          </Button>
        </>
      }
      meta={
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {contact.email && <Meta label="Email" value={contact.email} />}
          {contact.phone && <Meta label="Phone" value={contact.phone} mono />}
          {contact.whatsapp && <Meta label="WhatsApp" value={contact.whatsapp} mono />}
          {contact.linkedin && <Meta label="LinkedIn" value={contact.linkedin} />}
          {contact.twitter && <Meta label="Twitter" value={contact.twitter} />}
          {company && <Meta label="Company" value={company.name} />}
          {contact.tags.length > 0 && (
            <Meta label="Tags" value={contact.tags.join(" · ")} />
          )}
        </div>
      }
      tabs={[
        {
          id: "timeline",
          label: "Timeline",
          count: timeline.length,
          content: <TimelineFeed events={timeline} emptyLabel="No activity yet for this contact." />,
        },
        {
          id: "notes",
          label: "Notes",
          content: <NotesTab relatedToType="contact" relatedToId={contactId} />,
        },
        {
          id: "tasks",
          label: "Tasks",
          content: <TasksTab relatedToType="contact" relatedToId={contactId} />,
        },
        {
          id: "files",
          label: "Files",
          content: <FilesTab relatedToType="contact" relatedToId={contactId} />,
        },
        {
          id: "deals",
          label: "Deals",
          content: <PlaceholderTab name="Deals" phase="Phase 5" />,
        },
      ]}
    />
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 min-w-0">
      <span className="eyebrow text-muted-foreground shrink-0 w-20">{label}</span>
      <span className={`truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function PlaceholderTab({ name, phase }: { name: string; phase: string }) {
  return (
    <div className="text-sm text-muted-foreground py-8">
      <p className="font-display italic text-xl mb-2">{name}.</p>
      <p>Lands in {phase}.</p>
    </div>
  );
}
