"use client";

import { useState } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import {
  FileText, Receipt, FileSignature, ClipboardList, Plus, Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ListLayout } from "@/components/atlas/list-layout";
import { FilterChips } from "@/components/atlas/filter-chips";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NewDocumentDialog } from "./new-document-dialog";

const KIND_FILTERS = [
  { value: "proposal", label: "Proposals" },
  { value: "quote", label: "Quotes" },
  { value: "invoice", label: "Invoices" },
  { value: "contract", label: "Contracts" },
  { value: "brief", label: "Briefs" },
  { value: "statement_of_work", label: "SOWs" },
] as const;
type Kind = (typeof KIND_FILTERS)[number]["value"];

const KIND_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  proposal: FileText,
  quote: Receipt,
  invoice: Receipt,
  contract: FileSignature,
  brief: ClipboardList,
  statement_of_work: FileText,
};

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const {
    results: documents,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.documents.listDocumentsPaginated,
    { kind: kind ?? undefined },
    { initialNumItems: 30 },
  );

  const isInitialLoad = pageStatus === "LoadingFirstPage";
  const canLoadMore = pageStatus === "CanLoadMore";
  const isLoadingMore = pageStatus === "LoadingMore";

  return (
    <>
      <ListLayout
        eyebrow="Documents"
        title="Everything you send out."
        description="Proposals, quotes, invoices, contracts. All in one place. Track opens, acceptance, and payment."
        searchPlaceholder="Search title or content…"
        searchValue={search}
        onSearch={setSearch}
        primaryAction={{ label: "New document", onClick: () => setNewOpen(true) }}
        count={documents.length}
        filterStrip={
          <FilterChips<Kind>
            options={KIND_FILTERS as unknown as { value: Kind; label: string }[]}
            value={kind}
            onChange={setKind}
          />
        }
      >
        {isInitialLoad ? (
          <ListSkeleton />
        ) : documents.length === 0 ? (
          <EmptyState onCreate={() => setNewOpen(true)} kind={kind} />
        ) : (
          <>
            <DocumentsTable documents={documents} />
            {(canLoadMore || isLoadingMore) && (
              <div className="pt-4 flex justify-center">
                <button
                  onClick={() => loadMore(30)}
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

      {newOpen && <NewDocumentDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

function DocumentsTable({ documents }: { documents: Doc<"documents">[] }) {
  return (
    <div className="border border-border">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b border-[var(--border-strong)] bg-background sticky top-0">
            <Th>Number</Th>
            <Th>Title</Th>
            <Th>Kind</Th>
            <Th>Status</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Issued</Th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => {
            const Icon = KIND_ICON[d.kind as Kind] ?? FileText;
            return (
              <tr
                key={d._id}
                className="border-b border-border hover:bg-muted/40 transition-colors"
              >
                <Td>
                  <Link
                    href={`/documents/${d._id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {d.number ?? "—"}
                  </Link>
                </Td>
                <Td>
                  <Link
                    href={`/documents/${d._id}`}
                    className="font-medium hover:underline flex items-center gap-2"
                  >
                    <Icon className="size-3.5 text-muted-foreground shrink-0" />
                    {d.title}
                  </Link>
                </Td>
                <Td className="text-muted-foreground capitalize">
                  {d.kind.replace(/_/g, " ")}
                </Td>
                <Td>
                  <StatusPill status={d.status} />
                </Td>
                <Td className="text-right font-mono num text-xs">
                  {formatCurrency(Number(d.totalCents), d.currency)}
                </Td>
                <Td className="text-right text-muted-foreground num text-xs">
                  {d.issueDate
                    ? new Date(d.issueDate).toLocaleDateString("en-KE", {
                        day: "numeric", month: "short", year: "2-digit",
                      })
                    : "—"}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListSkeleton() {
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

function EmptyState({ onCreate, kind }: { onCreate: () => void; kind: Kind | null }) {
  return (
    <div className="border border-border border-dashed py-16 text-center space-y-4">
      <p className="font-display text-2xl italic text-muted-foreground">
        {kind ? `No ${kind.replace(/_/g, " ")}s yet.` : "Your paperwork starts here."}
      </p>
      <p className="text-sm text-muted-foreground max-w-prose mx-auto">
        Proposals, quotes, invoices, contracts. Draft them here, share via
        a public link, track when the recipient opens or accepts.
      </p>
      <button
        onClick={onCreate}
        className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
      >
        + New document
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

const STATUS_STYLES: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  sent: "border-[var(--info)] text-[var(--info)]",
  viewed: "border-[var(--info)] text-[var(--info)]",
  accepted: "border-[var(--success)] text-[var(--success)]",
  rejected: "border-[var(--danger)] text-[var(--danger)]",
  paid: "border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10",
  partially_paid: "border-[var(--warning)] text-[var(--warning)]",
  overdue: "border-[var(--danger)] text-[var(--danger)]",
  cancelled: "border-border text-muted-foreground opacity-60",
  void: "border-border text-muted-foreground opacity-40",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatCurrency(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}
