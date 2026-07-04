"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Mail, Phone, MessageSquare, MoreHorizontal, Archive, Linkedin, Twitter, Sparkles } from "lucide-react";
import { RecordSheet } from "@/components/atlas/record-sheet";
import { OutreachDrafter } from "@/components/atlas/outreach-drafter";
import { TimelineFeed } from "@/components/atlas/timeline-feed";
import { NotesTab } from "@/components/atlas/notes-tab";
import { TasksTab } from "@/components/atlas/tasks-tab";
import { FilesTab } from "@/components/atlas/files-tab";
import { DealsTab } from "@/components/atlas/deals-tab";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [outreachOpen, setOutreachOpen] = useState(false);

  if (!data) {
    return (
      <RecordSheet
        open={open}
        onOpenChange={onOpenChange}
        eyebrow="Contact"
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

  const { contact, company, timeline } = data;
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const initials = fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
    <>
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Contact"
      title={fullName}
      subtitle={contact.title || company?.name || undefined}
      initials={initials || "?"}
      status={contact.lifecycleStage}
      actions={
        <>
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Mail className="size-3.5" />
              Email
            </a>
          )}
          {contact.whatsapp && (
            <a
              href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <MessageSquare className="size-3.5" />
              WhatsApp
            </a>
          )}
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Phone className="size-3.5" />
              Call
            </a>
          )}
          {contact.linkedin && (
            <a
              href={
                contact.linkedin.startsWith("http")
                  ? contact.linkedin
                  : `https://linkedin.com/in/${contact.linkedin}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Linkedin className="size-3.5" />
              LinkedIn
            </a>
          )}
          {(contact.email || contact.phone) && contact.companyId && (
            <button
              onClick={() => setOutreachOpen(true)}
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "gap-1.5",
              )}
            >
              <Sparkles className="size-3.5" />
              Draft outreach
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "ml-auto",
              )}
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleArchive}
                className="text-destructive"
              >
                <Archive className="size-3.5" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      meta={
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {contact.email && <Meta label="Email" value={contact.email} mono />}
          {contact.phone && <Meta label="Phone" value={contact.phone} mono />}
          {contact.whatsapp && (
            <Meta label="WhatsApp" value={contact.whatsapp} mono />
          )}
          {contact.linkedin && <Meta label="LinkedIn" value={contact.linkedin} />}
          {contact.twitter && <Meta label="Twitter" value={contact.twitter} />}
          {company && <Meta label="Company" value={company.name} />}
          {contact.tags.length > 0 && (
            <div className="col-span-full flex items-baseline gap-3 min-w-0">
              <dt className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground shrink-0 w-20">
                Tags
              </dt>
              <dd className="flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>
      }
      tabs={[
        {
          id: "timeline",
          label: "Timeline",
          count: timeline.length,
          content: (
            <TimelineFeed
              events={timeline}
              emptyLabel="No activity yet for this contact."
            />
          ),
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
          content: <DealsTab scope="contact" id={contactId} />,
        },
      ]}
    />
    {contact.companyId && (
      <OutreachDrafter
        companyId={contact.companyId}
        contactId={contactId}
        companyName={company?.name ?? fullName}
        hasEmail={Boolean(contact.email)}
        hasPhone={Boolean(contact.phone)}
        primaryEmail={contact.email}
        primaryPhone={contact.phone}
        open={outreachOpen}
        onOpenChange={setOutreachOpen}
      />
    )}
    </>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <dt className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground shrink-0 w-20">
        {label}
      </dt>
      <dd className={`truncate ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
