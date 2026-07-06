"use client";

import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, usePaginatedQuery, useAction } from "convex/react";
import { Mail, Phone, MessageSquare, Loader2, MoreHorizontal, Sparkles, Copy, Gauge } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ListLayout } from "@/components/atlas/list-layout";
import { AgentPicksBar } from "@/components/atlas/agent-picks-bar";
import { FilterChips } from "@/components/atlas/filter-chips";
import { BulkActionBar } from "@/components/atlas/bulk-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { NewContactSheet } from "./new-contact-sheet";
import { ContactDetailSheet } from "./contact-detail-sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton as SharedTableSkeleton } from "@/components/atlas/skeletons";
import { toast } from "sonner";

const LIFECYCLE_FILTERS = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "qualified", label: "Qualified" },
  { value: "customer", label: "Customer" },
  { value: "lost", label: "Lost" },
] as const;
type LifecycleStage = (typeof LIFECYCLE_FILTERS)[number]["value"];

export default function ContactsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open") as Id<"contacts"> | null;

  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleStage | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<Id<"contacts">>>(new Set());

  function setActiveId(id: Id<"contacts"> | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("open", id);
    else params.delete("open");
    router.replace(`${pathname}${params.toString() ? "?" + params.toString() : ""}`);
  }

  const {
    results: contacts,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.contacts.listPaginated,
    {
      search: search.trim() || undefined,
      lifecycleStage: lifecycle ?? undefined,
    },
    { initialNumItems: 50 },
  );
  const bulkUpdate = useMutation(api.contacts.bulkUpdate);
  const bulkArchive = useMutation(api.contacts.bulkArchive);

  const isInitialLoad = pageStatus === "LoadingFirstPage";
  const canLoadMore = pageStatus === "CanLoadMore";
  const isLoadingMore = pageStatus === "LoadingMore";

  const toggleSelected = (id: Id<"contacts">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (all: boolean) => {
    if (all && contacts) setSelected(new Set(contacts.map((c) => c._id)));
    else setSelected(new Set());
  };

  return (
    <>
      <ListLayout
        eyebrow="Contacts"
        title="Your network."
        description="People you've spoken to, sold to, or want to. Click any row to open."
        searchPlaceholder="Search by name…"
        searchValue={search}
        onSearch={setSearch}
        primaryAction={{ label: "New contact", onClick: () => setNewOpen(true) }}
        count={contacts.length}
        filterStrip={
          <FilterChips<LifecycleStage>
            options={LIFECYCLE_FILTERS as unknown as { value: LifecycleStage; label: string }[]}
            value={lifecycle}
            onChange={setLifecycle}
          />
        }
      >
        {isInitialLoad ? (
          <SharedTableSkeleton rows={10} columns={4} />
        ) : contacts.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <>
            {contacts.length >= 4 && (
              <div className="mb-4">
                <AgentPicksBar
                  actionRef={api.pageAgents.rankContactsForOutreach}
                  title="AI · Reach out to these first"
                  emptyLabel="Nothing to prioritise right now."
                  renderTitle={(r) => {
                    const rec = r as {
                      firstName?: string;
                      lastName?: string;
                      companyName?: string;
                      title?: string;
                    };
                    const name = [rec.firstName, rec.lastName].filter(Boolean).join(" ");
                    return rec.companyName ? `${name} · ${rec.companyName}` : name || "Contact";
                  }}
                  renderPrimaryAction={(r, pick) => ({
                    label: "Draft outreach",
                    onClick: () => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set("open", pick.id);
                      params.set("drafter", "1");
                      router.replace(`${pathname}?${params.toString()}`);
                    },
                  })}
                />
              </div>
            )}
            <ContactsTable
              contacts={contacts}
              onOpen={setActiveId}
              selected={selected}
              onToggle={toggleSelected}
              onToggleAll={toggleAll}
            />
            {(canLoadMore || isLoadingMore) && (
              <div className="pt-4 flex justify-center">
                <button
                  onClick={() => loadMore(50)}
                  disabled={isLoadingMore}
                  className="inline-flex items-center gap-1.5 h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {isLoadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </ListLayout>

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onChangeStage={async (stage) => {
          await bulkUpdate({ ids: Array.from(selected), patch: { lifecycleStage: stage } });
          toast.success(`${selected.size} updated.`);
          setSelected(new Set());
        }}
        onArchive={async () => {
          await bulkArchive({ ids: Array.from(selected) });
          toast.success(`${selected.size} archived.`);
          setSelected(new Set());
        }}
      />

      <NewContactSheet open={newOpen} onOpenChange={setNewOpen} />
      {openId && (
        <ContactDetailSheet
          contactId={openId}
          open={true}
          onOpenChange={(o) => !o && setActiveId(null)}
          initialDrafterOpen={searchParams.get("drafter") === "1"}
        />
      )}
    </>
  );
}

function ContactsTable({
  contacts,
  onOpen,
  selected,
  onToggle,
  onToggleAll,
}: {
  contacts: Array<{
    _id: Id<"contacts">;
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    title?: string;
    lifecycleStage: string;
    _creationTime: number;
  }>;
  onOpen: (id: Id<"contacts">) => void;
  selected: Set<Id<"contacts">>;
  onToggle: (id: Id<"contacts">) => void;
  onToggleAll: (all: boolean) => void;
}) {
  const allChecked = contacts.length > 0 && selected.size === contacts.length;
  const someChecked = selected.size > 0 && !allChecked;

  return (
    <div className="border border-border overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="text-left">
          <tr className="border-b border-[var(--border-strong)] bg-background sticky top-0">
            <Th className="w-10">
              <Checkbox
                checked={allChecked}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label="Select all"
              />
            </Th>
            <Th>Name</Th>
            <Th>Title</Th>
            <Th>Contact</Th>
            <Th>Stage</Th>
            <Th className="text-right">Added</Th>
            <Th className="w-10"><span className="sr-only">Actions</span></Th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr
              key={c._id}
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-row-checkbox]")) return;
                onOpen(c._id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(c._id);
              }}
              className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors focus:outline-none focus:bg-muted/60"
            >
              <td
                data-row-checkbox
                onClick={(e) => e.stopPropagation()}
                className="px-4 py-2.5"
              >
                <Checkbox
                  checked={selected.has(c._id)}
                  onCheckedChange={() => onToggle(c._id)}
                  aria-label={`Select ${c.firstName}`}
                />
              </td>
              <Td>
                <span className="font-medium">
                  {c.firstName}
                  {c.lastName && ` ${c.lastName}`}
                </span>
              </Td>
              <Td className="text-muted-foreground">{c.title ?? "—"}</Td>
              <Td>
                <div className="flex items-center gap-3 text-muted-foreground">
                  {c.email && (
                    <span className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </span>
                  )}
                  {c.phone && (
                    <span className="flex items-center gap-1.5 num text-xs">
                      <Phone className="size-3 shrink-0" />
                      {c.phone}
                    </span>
                  )}
                  {c.whatsapp && <MessageSquare className="size-3 shrink-0" />}
                </div>
              </Td>
              <Td>
                <LifecyclePill stage={c.lifecycleStage} />
              </Td>
              <Td className="text-right text-muted-foreground num text-xs">
                {new Date(c._creationTime).toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "short",
                  year: "2-digit",
                })}
              </Td>
              <td
                className="px-2 py-2.5"
                onClick={(e) => e.stopPropagation()}
              >
                <ContactRowActions
                  contactId={c._id}
                  email={c.email}
                  onOpen={() => onOpen(c._id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="border border-border divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 grid grid-cols-3 md:grid-cols-6 gap-4 items-center">
          {Array.from({ length: 6 }).map((_, j) => (
            <Skeleton key={j} className="h-4 w-full max-w-[120px]" />
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
        Your network starts here.
      </p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Add your first contact manually, or use <a href="/prospector" className="text-primary underline">Prospector</a> to bulk-import from Google Maps.
      </p>
      <button
        onClick={onCreate}
        className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
      >
        + New contact
      </button>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`eyebrow font-mono h-9 px-4 text-muted-foreground font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`}>{children}</td>;
}

const LIFECYCLE_STYLES: Record<string, string> = {
  cold: "border-border text-muted-foreground",
  warm: "border-[var(--warning)] text-[var(--warning)]",
  qualified: "border-[var(--info)] text-[var(--info)]",
  customer: "border-[var(--success)] text-[var(--success)]",
  lost: "border-[var(--danger)] text-[var(--danger)]",
  archived: "border-border text-muted-foreground opacity-60",
};

function LifecyclePill({ stage }: { stage: string }) {
  return (
    <span
      className={`inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5 bg-transparent ${
        LIFECYCLE_STYLES[stage] ?? LIFECYCLE_STYLES.cold
      }`}
    >
      {stage}
    </span>
  );
}


/* ============================================================ */
/* Per-row AI actions                                             */
/* ============================================================ */

function ContactRowActions({
  contactId,
  email,
  onOpen,
}: {
  contactId: Id<"contacts">;
  email?: string;
  onOpen: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scoreFit = useAction(api.aiWorkflows.scoreContactFit);
  const [busy, setBusy] = useState<"score" | null>(null);

  async function handleScore(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("score");
    try {
      const r = await scoreFit({ contactId });
      toast.success(`Fit: ${r.score}/100 · ${r.reason}`, { duration: 6000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Score failed");
    } finally {
      setBusy(null);
    }
  }

  function openDrafter(e: React.MouseEvent) {
    e.stopPropagation();
    const params = new URLSearchParams(searchParams.toString());
    params.set("open", contactId);
    params.set("drafter", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function copyEmail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!email) return;
    await navigator.clipboard.writeText(email);
    toast.success("Email copied");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded hover:bg-muted transition-colors inline-flex items-center justify-center"
        aria-label="Row actions"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <MoreHorizontal className="size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onOpen}>
          <Mail className="size-3.5 mr-2" />
          Open details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openDrafter}>
          <Sparkles className="size-3.5 mr-2 text-primary" />
          Draft outreach with AI
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleScore}>
          <Gauge className="size-3.5 mr-2" />
          Score fit with AI
        </DropdownMenuItem>
        {email && (
          <DropdownMenuItem onClick={copyEmail}>
            <Copy className="size-3.5 mr-2" />
            Copy email
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
