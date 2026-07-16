"use client";

import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, usePaginatedQuery, useAction } from "convex/react";
import { Globe, MapPin, Loader2, Sparkles, MoreHorizontal, Copy, Gauge, Mail } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ListLayout } from "@/components/atlas/list-layout";
import { AgentPicksBar } from "@/components/atlas/agent-picks-bar";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/atlas/filter-chips";
import { BulkActionBar } from "@/components/atlas/bulk-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { NewCompanySheet } from "./new-company-sheet";
import { CompanyDetailSheet } from "./company-detail-sheet";
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

export default function CompaniesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open") as Id<"companies"> | null;

  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleStage | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<Id<"companies">>>(new Set());

  function setActiveId(id: Id<"companies"> | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("open", id);
    else params.delete("open");
    router.replace(`${pathname}${params.toString() ? "?" + params.toString() : ""}`);
  }

  const {
    results: companies,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.companies.listPaginated,
    {
      search: search.trim() || undefined,
      lifecycleStage: lifecycle ?? undefined,
    },
    { initialNumItems: 50 },
  );
  const bulkUpdate = useMutation(api.companies.bulkUpdate);
  const bulkArchive = useMutation(api.companies.bulkArchive);
  const purgeDisqualified = useMutation(api.prospector.purgeDisqualifiedImports);
  const [purging, setPurging] = useState(false);

  async function handlePurge() {
    // Dry run first so user sees what will happen
    const preview = await purgeDisqualified({ dryRun: true });
    if (preview.companiesArchived === 0 && preview.resultsRejected === 0) {
      toast.info("No malls or mega-brand companies to purge.");
      return;
    }
    const list = preview.matches.slice(0, 5).join(", ");
    if (
      !confirm(
        `Archive ${preview.companiesArchived} companies + reject ${preview.resultsRejected} prospector results?\n\nMatches: ${list}${preview.companiesArchived > 5 ? " …" : ""}`,
      )
    ) {
      return;
    }
    setPurging(true);
    try {
      const r = await purgeDisqualified({ dryRun: false });
      toast.success(
        `Archived ${r.companiesArchived} · Rejected ${r.resultsRejected}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purge failed.");
    } finally {
      setPurging(false);
    }
  }

  const isInitialLoad = pageStatus === "LoadingFirstPage";
  const canLoadMore = pageStatus === "CanLoadMore";
  const isLoadingMore = pageStatus === "LoadingMore";

  const toggleSelected = (id: Id<"companies">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (all: boolean) => {
    if (all && companies) setSelected(new Set(companies.map((c) => c._id)));
    else setSelected(new Set());
  };

  return (
    <>
      <ListLayout
        eyebrow="Companies"
        title="The book."
        description="Every business in your orbit. Prospects, customers, partners — one list."
        searchPlaceholder="Search by name…"
        searchValue={search}
        onSearch={setSearch}
        primaryAction={{ label: "New company", onClick: () => setNewOpen(true) }}
        secondaryAction={
          <Button
            variant="outline"
            size="default"
            onClick={handlePurge}
            disabled={purging}
            title="Archive companies + reject prospector results that are malls, plazas, mega-brands"
          >
            {purging ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Cleanup malls
          </Button>
        }
        count={companies.length}
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
        ) : companies.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <>
            {companies.length >= 4 && (
              <div className="mb-4">
                <AgentPicksBar
                  actionRef={api.pageAgents.rankCompaniesForOutreach}
                  title="AI · Reach out to these first"
                  emptyLabel="Nothing to prioritise right now."
                  renderTitle={(r) => {
                    const rec = r as {
                      name?: string;
                      industry?: string;
                    };
                    return rec.industry
                      ? `${rec.name} · ${rec.industry}`
                      : rec.name ?? "Company";
                  }}
                  renderPrimaryAction={(_r, pick) => ({
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
            <CompaniesTable
              companies={companies}
              onOpen={setActiveId}
              selected={selected}
              onToggle={toggleSelected}
              onToggleAll={toggleAll}
            />
            {(canLoadMore || isLoadingMore) && (
              <div className="pt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => loadMore(50)}
                  disabled={isLoadingMore}
                  className="h-9 text-xs font-mono uppercase tracking-[0.12em]"
                >
                  {isLoadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Load more
                </Button>
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

      <NewCompanySheet open={newOpen} onOpenChange={setNewOpen} />
      {openId && (
        <CompanyDetailSheet
          companyId={openId}
          open={true}
          onOpenChange={(o) => {
            if (!o) {
              // Also clear the draft param when closing
              const params = new URLSearchParams(searchParams.toString());
              params.delete("open");
              params.delete("draft");
              router.replace(
                `${pathname}${params.toString() ? "?" + params.toString() : ""}`,
              );
            }
          }}
          initialDrafterOpen={searchParams.get("drafter") === "1"}
        />
      )}
    </>
  );
}

function CompaniesTable({
  companies,
  onOpen,
  selected,
  onToggle,
  onToggleAll,
}: {
  companies: Array<{
    _id: Id<"companies">;
    name: string;
    domain?: string;
    city?: string;
    country: string;
    industry?: string;
    lifecycleStage: string;
    _creationTime: number;
  }>;
  onOpen: (id: Id<"companies">) => void;
  selected: Set<Id<"companies">>;
  onToggle: (id: Id<"companies">) => void;
  onToggleAll: (all: boolean) => void;
}) {
  const allChecked = companies.length > 0 && selected.size === companies.length;
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
            <Th>Domain</Th>
            <Th>Industry</Th>
            <Th>Location</Th>
            <Th>Stage</Th>
            <Th className="text-right">Added</Th>
            <Th className="w-10"><span className="sr-only">Actions</span></Th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
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
                  aria-label={`Select ${c.name}`}
                />
              </td>
              <Td>
                <span className="font-medium">{c.name}</span>
              </Td>
              <Td>
                {c.domain ? (
                  <span className="text-muted-foreground flex items-center gap-1.5 truncate max-w-[200px]">
                    <Globe className="size-3 shrink-0" />
                    <span className="truncate">{c.domain}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Td>
              <Td className="text-muted-foreground">{c.industry ?? "—"}</Td>
              <Td>
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {(c.city || c.country !== "KE") && <MapPin className="size-3" />}
                  <span className="truncate">
                    {[c.city, c.country].filter(Boolean).join(", ")}
                  </span>
                </span>
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
                <CompanyRowActions
                  companyId={c._id}
                  domain={c.domain}
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
        <div key={i} className="px-4 py-3 grid grid-cols-7 gap-4 items-center">
          {Array.from({ length: 7 }).map((_, j) => (
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
        No companies yet.
      </p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Add your first company manually, or use <a href="/prospector" className="text-primary underline">Prospector</a> to bulk-import from Google Maps.
      </p>
      <Button
        onClick={onCreate}
        size="lg"
        className="font-mono uppercase tracking-[0.12em] text-xs"
      >
        + New company
      </Button>
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

function CompanyRowActions({
  companyId,
  domain,
  onOpen,
}: {
  companyId: Id<"companies">;
  domain?: string;
  onOpen: () => void;
}) {
  const scoreFit = useAction(api.aiWorkflows.scoreCompanyFit);
  const [busy, setBusy] = useState<"score" | null>(null);

  async function handleScore(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy("score");
    try {
      const r = await scoreFit({ companyId });
      toast.success(`Fit: ${r.score}/100 · ${r.reason}`, { duration: 6000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Score failed");
    } finally {
      setBusy(null);
    }
  }

  async function copyDomain(e: React.MouseEvent) {
    e.stopPropagation();
    if (!domain) return;
    await navigator.clipboard.writeText(domain);
    toast.success("Domain copied");
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
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Sparkles className="size-3.5 mr-2 text-primary" />
          Draft outreach
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleScore}>
          <Gauge className="size-3.5 mr-2" />
          Score fit with AI
        </DropdownMenuItem>
        {domain && (
          <DropdownMenuItem onClick={copyDomain}>
            <Copy className="size-3.5 mr-2" />
            Copy domain
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
