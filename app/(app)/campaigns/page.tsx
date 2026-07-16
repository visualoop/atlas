"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import {
  Plus, Loader2, Play, Pause, Mail, MessageSquare, ChevronRight,
  Users, Sparkles, Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ListLayout } from "@/components/atlas/list-layout";
import { FilterChips } from "@/components/atlas/filter-chips";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { NewCampaignDialog } from "./new-campaign-dialog";
import { CampaignSheet } from "./campaign-sheet";

const STATUS_FILTERS = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "complete", label: "Complete" },
] as const;
type Status = (typeof STATUS_FILTERS)[number]["value"];

export default function CampaignsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [activeId, setActiveId] = useState<Id<"campaigns"> | null>(null);

  const campaigns = useQuery(api.campaigns.listCampaigns, {
    status: status ?? undefined,
    limit: 200,
  });

  const filtered = campaigns?.filter((c) =>
    search.trim().length < 2 ? true : c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <ListLayout
        eyebrow="Campaigns"
        title="Multi-step sequences that actually convert."
        description="Email + WhatsApp drips. Auto-pause on reply, stop on won deal. Every message is a conversation, not a broadcast."
        searchPlaceholder="Search campaigns…"
        searchValue={search}
        onSearch={setSearch}
        primaryAction={{ label: "New campaign", onClick: () => setNewOpen(true) }}
        count={filtered?.length}
        filterStrip={
          <FilterChips<Status>
            options={STATUS_FILTERS as unknown as { value: Status; label: string }[]}
            value={status}
            onChange={setStatus}
          />
        }
      >
        {filtered === undefined ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <CampaignsTable campaigns={filtered} onOpen={setActiveId} />
        )}
      </ListLayout>

      {newOpen && <NewCampaignDialog onClose={() => setNewOpen(false)} onCreated={setActiveId} />}
      {activeId && <CampaignSheet campaignId={activeId} onClose={() => setActiveId(null)} />}
    </>
  );
}

function CampaignsTable({
  campaigns, onOpen,
}: { campaigns: Doc<"campaigns">[]; onOpen: (id: Id<"campaigns">) => void }) {
  return (
    <div className="border border-border overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="text-left">
          <tr className="border-b border-[var(--border-strong)] bg-background sticky top-0">
            <Th>Name</Th>
            <Th>Channel</Th>
            <Th>Status</Th>
            <Th className="text-right">Recipients</Th>
            <Th className="text-right">Sent</Th>
            <Th className="text-right">Replies</Th>
            <Th className="text-right">Started</Th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr
              key={c._id}
              tabIndex={0}
              onClick={() => onOpen(c._id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(c._id)}
              className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors focus:outline-none focus:bg-muted/60"
            >
              <Td>
                <span className="font-medium">{c.name}</span>
                {c.description && (
                  <p className="text-xs text-muted-foreground truncate max-w-md">{c.description}</p>
                )}
              </Td>
              <Td>
                <ChannelIcon channel={c.channel} />
              </Td>
              <Td>
                <StatusPill status={c.status} />
              </Td>
              <Td className="text-right font-mono num text-xs">{c.recipientCount}</Td>
              <Td className="text-right font-mono num text-xs">{c.sentCount}</Td>
              <Td className="text-right font-mono num text-xs">{c.replyCount}</Td>
              <Td className="text-right text-muted-foreground num text-xs">
                {c.startedAt
                  ? formatDistanceToNowStrict(new Date(c.startedAt), { addSuffix: true })
                  : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
      {channel === "email" && <Mail className="size-3.5" />}
      {channel === "whatsapp" && <MessageSquare className="size-3.5" />}
      {channel === "multi" && (
        <>
          <Mail className="size-3.5" />
          <MessageSquare className="size-3.5" />
        </>
      )}
      {channel}
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-border divide-y divide-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-3 grid grid-cols-7 gap-4 items-center">
          {Array.from({ length: 7 }).map((_, j) => (
            <Skeleton key={j} className="h-4 w-full max-w-[100px]" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="border border-border border-dashed py-16 text-center space-y-4">
      <p className="font-display text-2xl italic text-muted-foreground">
        No campaigns yet.
      </p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Build a drip — pick an audience, write the steps, launch. Atlas
        pauses each recipient the moment they reply so nobody gets
        harassed. Deals that close stop the sequence automatically.
      </p>
      <Button
        onClick={onCreate}
        size="lg"
        className="font-mono uppercase tracking-[0.12em] text-xs"
      >
        <Plus className="size-3.5" /> New campaign
      </Button>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`eyebrow font-mono h-9 px-4 text-muted-foreground font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`}>{children}</td>;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  scheduled: "border-[var(--info)] text-[var(--info)]",
  running: "border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10",
  paused: "border-[var(--warning)] text-[var(--warning)]",
  complete: "border-border text-muted-foreground",
  cancelled: "border-border text-muted-foreground opacity-60",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status}
    </span>
  );
}
