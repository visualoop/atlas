"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Workflow, TrendingUp, Loader2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

interface Props {
  scope: "contact" | "company";
  id: Id<"contacts"> | Id<"companies">;
}

export function DealsTab({ scope, id }: Props) {
  const deals = useQuery(
    scope === "contact"
      ? api.pipelines.listDealsForContact
      : api.pipelines.listDealsForCompany,
    scope === "contact" ? { contactId: id as Id<"contacts"> } : { companyId: id as Id<"companies"> },
  );

  if (deals === undefined) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="p-6 space-y-3 text-center">
        <Workflow className="size-8 text-muted-foreground mx-auto" />
        <p className="font-display italic text-xl text-muted-foreground">
          No deals yet.
        </p>
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          Head to{" "}
          <Link href="/pipelines" className="text-primary underline">
            Pipelines
          </Link>{" "}
          and add a new deal — link it to this {scope} to see it here.
        </p>
      </div>
    );
  }

  const total = deals.reduce((sum, d) => sum + d.amountCents, 0n);
  const won = deals.filter((d) => d.wonAt).reduce((sum, d) => sum + d.amountCents, 0n);
  const open = deals.filter((d) => !d.wonAt && !d.lostAt).reduce((sum, d) => sum + d.amountCents, 0n);
  const currency = deals[0]?.currency ?? "KES";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Total" cents={total} currency={currency} />
        <Stat label="Open" cents={open} currency={currency} />
        <Stat label="Won" cents={won} currency={currency} />
      </div>

      <ul className="border border-border divide-y divide-border">
        {deals
          .sort((a, b) => b._creationTime - a._creationTime)
          .map((d) => (
            <DealRow key={d._id} deal={d} />
          ))}
      </ul>
    </div>
  );
}

function Stat({ label, cents, currency }: { label: string; cents: bigint; currency: string }) {
  return (
    <div className="border border-border p-2 space-y-0.5">
      <p className="eyebrow text-[10px]">{label}</p>
      <p className="font-mono num text-sm">
        {currency} {(cents / 100n).toLocaleString()}
      </p>
    </div>
  );
}

function DealRow({ deal: d }: { deal: Doc<"deals"> }) {
  const state = d.wonAt ? "won" : d.lostAt ? "lost" : "open";
  return (
    <li>
      <Link
        href={`/pipelines?deal=${d._id}`}
        className="block px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium truncate">{d.name}</p>
          <StatePill state={state} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground font-mono">
          <span className="num">
            {d.currency} {(d.amountCents / 100n).toLocaleString()}
          </span>
          {typeof d.healthScore === "number" && (
            <span className="inline-flex items-center gap-0.5">
              <TrendingUp className="size-2.5" />
              {d.healthScore}
            </span>
          )}
          <span>{formatDistanceToNowStrict(new Date(d._creationTime), { addSuffix: true })}</span>
        </div>
      </Link>
    </li>
  );
}

function StatePill({ state }: { state: "open" | "won" | "lost" }) {
  const styles = {
    open: "text-muted-foreground border-border",
    won: "text-[var(--success)] border-[var(--success)]",
    lost: "text-[var(--destructive)] border-[var(--destructive)]",
  };
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-[0.12em] border px-1.5 py-[1px] shrink-0 ${styles[state]}`}
    >
      {state}
    </span>
  );
}
