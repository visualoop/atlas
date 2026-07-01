"use client";

import { useQuery, useMutation } from "convex/react";
import { Mail, Phone, Globe, Trash2 } from "lucide-react";
import { RecordSheet } from "@/components/atlas/record-sheet";
import { TimelineFeed } from "@/components/atlas/timeline-feed";
import { NotesTab } from "@/components/atlas/notes-tab";
import { TasksTab } from "@/components/atlas/tasks-tab";
import { FilesTab } from "@/components/atlas/files-tab";
import { DealsTab } from "@/components/atlas/deals-tab";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

export function CompanyDetailSheet({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: Id<"companies">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useQuery(api.companies.get, { id: companyId });
  const archive = useMutation(api.companies.archive);

  if (!data) {
    return (
      <RecordSheet
        open={open}
        onOpenChange={onOpenChange}
        eyebrow="Company"
        title="Loading…"
        initials="…"
        tabs={[
          {
            id: "timeline",
            label: "Timeline",
            content: <p className="text-sm text-muted-foreground">Loading…</p>,
          },
        ]}
      />
    );
  }

  const { company, contacts, timeline } = data;
  const initials = company.name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleArchive() {
    try {
      await archive({ id: companyId });
      toast.success("Company archived.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive");
    }
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={`Company · ${company.lifecycleStage}`}
      title={company.name}
      subtitle={company.industry || company.domain || undefined}
      initials={initials || "?"}
      actions={
        <>
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center h-8 px-4 text-xs border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <Globe className="size-3.5 mr-1.5" /> Website
            </a>
          )}
          {company.emailPrimary && (
            <a
              href={`mailto:${company.emailPrimary}`}
              className="inline-flex items-center h-8 px-4 text-xs border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
            >
              <Mail className="size-3.5 mr-1.5" /> Email
            </a>
          )}
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
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
          {company.domain && <Meta label="Domain" value={company.domain} />}
          {company.industry && <Meta label="Industry" value={company.industry} />}
          {company.size && <Meta label="Size" value={company.size} />}
          {(company.city || company.country) && (
            <Meta label="Location" value={[company.city, company.country].filter(Boolean).join(", ")} />
          )}
          {company.phone && <Meta label="Phone" value={company.phone} mono />}
          {company.emailPrimary && <Meta label="Email" value={company.emailPrimary} />}
          {company.tags.length > 0 && <Meta label="Tags" value={company.tags.join(" · ")} />}
        </div>
      }
      tabs={[
        {
          id: "timeline",
          label: "Timeline",
          count: timeline.length,
          content: <TimelineFeed events={timeline} emptyLabel="No activity yet for this company." />,
        },
        {
          id: "contacts",
          label: "Contacts",
          count: contacts.length,
          content: <ContactsList contacts={contacts} />,
        },
        {
          id: "notes",
          label: "Notes",
          content: <NotesTab relatedToType="company" relatedToId={companyId} />,
        },
        {
          id: "tasks",
          label: "Tasks",
          content: <TasksTab relatedToType="company" relatedToId={companyId} />,
        },
        {
          id: "files",
          label: "Files",
          content: <FilesTab relatedToType="company" relatedToId={companyId} />,
        },
        {
          id: "deals",
          label: "Deals",
          content: <DealsTab scope="company" id={companyId} />,
        },
      ]}
    />
  );
}

function ContactsList({ contacts }: { contacts: Array<{ _id: Id<"contacts">; firstName: string; lastName?: string; title?: string; email?: string }> }) {
  if (contacts.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No contacts at this company yet.</p>;
  }
  return (
    <ul className="border border-border divide-y divide-border">
      {contacts.map((c) => (
        <li key={c._id} className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {c.firstName}
              {c.lastName ? ` ${c.lastName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground truncate">{c.title ?? c.email ?? ""}</p>
          </div>
        </li>
      ))}
    </ul>
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
