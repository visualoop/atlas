"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Globe, MapPin } from "lucide-react";
import { ListLayout } from "@/components/atlas/list-layout";
import { FilterChips } from "@/components/atlas/filter-chips";
import { NewCompanySheet } from "./new-company-sheet";
import { CompanyDetailSheet } from "./company-detail-sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";

const LIFECYCLE_FILTERS = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "qualified", label: "Qualified" },
  { value: "customer", label: "Customer" },
  { value: "lost", label: "Lost" },
] as const;
type LifecycleStage = (typeof LIFECYCLE_FILTERS)[number]["value"];

export default function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleStage | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [activeId, setActiveId] = useState<Id<"companies"> | null>(null);

  const companies = useQuery(api.companies.list, {
    search: search.trim() || undefined,
    lifecycleStage: lifecycle ?? undefined,
    limit: 200,
  });

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
        count={companies?.length}
        filterStrip={
          <FilterChips<LifecycleStage>
            options={LIFECYCLE_FILTERS as unknown as { value: LifecycleStage; label: string }[]}
            value={lifecycle}
            onChange={setLifecycle}
          />
        }
      >
        {companies === undefined ? (
          <TableSkeleton />
        ) : companies.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <CompaniesTable companies={companies} onOpen={(id) => setActiveId(id)} />
        )}
      </ListLayout>

      <NewCompanySheet open={newOpen} onOpenChange={setNewOpen} />
      {activeId && (
        <CompanyDetailSheet
          companyId={activeId}
          open={true}
          onOpenChange={(o) => !o && setActiveId(null)}
        />
      )}
    </>
  );
}

function CompaniesTable({
  companies,
  onOpen,
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
}) {
  return (
    <div className="border border-border">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-[var(--border-strong)] bg-background sticky top-0">
            <Th>Name</Th>
            <Th>Domain</Th>
            <Th>Industry</Th>
            <Th>Location</Th>
            <Th>Stage</Th>
            <Th className="text-right">Added</Th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr
              key={c._id}
              tabIndex={0}
              onClick={() => onOpen(c._id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(c._id);
              }}
              className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors focus:outline-none focus:bg-muted/60"
            >
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
        <div key={i} className="px-4 py-3 grid grid-cols-6 gap-4 items-center">
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
        No companies yet.
      </p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Add your first company manually, or use Prospector (coming in Phase 3) to bulk-import from Google Maps.
      </p>
      <button
        onClick={onCreate}
        className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
      >
        + New company
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
