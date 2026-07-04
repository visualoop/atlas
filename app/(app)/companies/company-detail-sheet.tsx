"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import { Mail, Phone, Globe, MoreHorizontal, Archive, ExternalLink, MessageSquare, Sparkles } from "lucide-react";
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

  const [outreachOpen, setOutreachOpen] = useState(false);

  async function handleArchive() {
    try {
      await archive({ id: companyId });
      toast.success("Company archived.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive");
    }
  }

  // WhatsApp deep-link — Kenyan numbers usually stored as +254...
  const waNumber = (company.whatsapp ?? company.phone)?.replace(/[^\d]/g, "");

  return (
    <>
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Company"
      title={company.name}
      subtitle={company.industry || company.domain || undefined}
      initials={initials || "?"}
      status={company.lifecycleStage}
      actions={
        <>
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Globe className="size-3.5" />
              Website
              <ExternalLink className="size-3 opacity-60" />
            </a>
          )}
          {company.emailPrimary && (
            <a
              href={`mailto:${company.emailPrimary}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Mail className="size-3.5" />
              Email
            </a>
          )}
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Phone className="size-3.5" />
              Call
            </a>
          )}
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <MessageSquare className="size-3.5" />
              WhatsApp
            </a>
          )}
          {(company.emailPrimary || company.phone) && (
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
              <DropdownMenuItem onClick={handleArchive} className="text-destructive">
                <Archive className="size-3.5" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      meta={
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {company.domain && <Meta label="Domain" value={company.domain} mono />}
          {company.industry && <Meta label="Industry" value={company.industry} />}
          {company.size && <Meta label="Size" value={company.size} />}
          {(company.city || company.country) && (
            <Meta
              label="Location"
              value={[company.city, company.country].filter(Boolean).join(", ")}
            />
          )}
          {company.phone && <Meta label="Phone" value={company.phone} mono />}
          {company.emailPrimary && (
            <Meta label="Email" value={company.emailPrimary} mono />
          )}
          {company.tags.length > 0 && (
            <div className="col-span-full flex items-baseline gap-3 min-w-0">
              <dt className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground shrink-0 w-20">
                Tags
              </dt>
              <dd className="flex flex-wrap gap-1">
                {company.tags.map((t) => (
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
              emptyLabel="No activity yet for this company."
            />
          ),
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
    <OutreachDrafter
      companyId={companyId}
      companyName={company.name}
      hasEmail={Boolean(company.emailPrimary)}
      hasPhone={Boolean(company.phone)}
      primaryEmail={company.emailPrimary}
      primaryPhone={company.phone}
      open={outreachOpen}
      onOpenChange={setOutreachOpen}
    />
    </>
  );
}

function ContactsList({
  contacts,
}: {
  contacts: Array<{
    _id: Id<"contacts">;
    firstName: string;
    lastName?: string;
    title?: string;
    email?: string;
  }>;
}) {
  if (contacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No contacts at this company yet.
      </p>
    );
  }
  return (
    <ul className="rounded-md border divide-y">
      {contacts.map((c) => (
        <li key={c._id} className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {c.firstName}
              {c.lastName ? ` ${c.lastName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {c.title ?? c.email ?? ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
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
