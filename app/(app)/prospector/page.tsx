"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Search, MapPin, Star, ExternalLink, Loader2, Phone, Globe,
  Check, X, Trash2, ChevronRight, RefreshCw, Sparkles, Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { OutreachDrafter } from "@/components/atlas/outreach-drafter";
import { AgentPicksBar } from "@/components/atlas/agent-picks-bar";

/**
 * Popular Kenyan cities + Nairobi neighborhoods used as one-click
 * location chips. Text search results are noticeably better when you
 * scope to a specific neighborhood versus "Nairobi, Kenya" broadly.
 */
const QUICK_LOCATIONS = [
  "Nairobi CBD, Kenya",
  "Westlands, Nairobi",
  "Kilimani, Nairobi",
  "Karen, Nairobi",
  "Kileleshwa, Nairobi",
  "Parklands, Nairobi",
  "Ngong Road, Nairobi",
  "Eastleigh, Nairobi",
  "South B, Nairobi",
  "Mombasa, Kenya",
  "Kisumu, Kenya",
  "Nakuru, Kenya",
  "Eldoret, Kenya",
  "Thika, Kenya",
];

const LOCATION_PRESETS = [
  ...QUICK_LOCATIONS,
  "Nairobi, Kenya",
  "Runda, Nairobi",
  "Muthaiga, Nairobi",
  "Lavington, Nairobi",
  "Buruburu, Nairobi",
  "Embakasi, Nairobi",
  "Nyali, Mombasa",
  "Diani, Kenya",
  "Malindi, Kenya",
  "Kakamega, Kenya",
  "Nyeri, Kenya",
  "Machakos, Kenya",
];

export default function ProspectorPage() {
  const searches = useQuery(api.prospector.listSearches, {});
  const [activeSearchId, setActiveSearchId] = useState<Id<"prospectorSearches"> | null>(null);

  // Auto-select the newest search
  const derivedActive = activeSearchId ?? searches?.[0]?._id ?? null;

  return (
    <>
      <NewSearchForm onCreated={(id) => setActiveSearchId(id)} />

      <div className="mt-10 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
        {/* Left rail — search list */}
        <div className="space-y-2">
          <p className="eyebrow">Recent searches</p>
          {searches === undefined ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : searches.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nothing yet.</p>
          ) : (
            <ul className="border border-border divide-y divide-border">
              {searches.map((s) => (
                <li key={s._id}>
                  <button
                    onClick={() => setActiveSearchId(s._id)}
                    className={cn(
                      "w-full text-left px-3 py-3 hover:bg-muted/40 transition-colors",
                      derivedActive === s._id && "bg-muted/60",
                    )}
                  >
                    <p className="text-sm font-medium truncate">{s.query}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      {s.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {s.location}
                        </span>
                      )}
                      <span className="num">
                        {s.resultCount} · {s.importedCount} imported
                      </span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right pane — search results */}
        <div>
          {derivedActive ? (
            <ResultsPane searchId={derivedActive} />
          ) : (
            <div className="border border-dashed border-border py-16 text-center space-y-3">
              <p className="font-display italic text-2xl text-muted-foreground">
                Nothing selected.
              </p>
              <p className="text-sm text-muted-foreground max-w-prose mx-auto">
                Start a new search above, or pick one from your history.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New search form                                                      */
/* ------------------------------------------------------------------ */

function NewSearchForm({ onCreated }: { onCreated: (id: Id<"prospectorSearches">) => void }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("Nairobi, Kenya");
  const [busy, setBusy] = useState(false);
  const createSearch = useMutation(api.prospector.createSearch);
  const runSearch = useAction(api.prospectorActions.searchAndPersist);

  async function submit() {
    if (query.trim().length < 3) {
      toast.error("Enter at least 3 characters.");
      return;
    }
    setBusy(true);
    try {
      const id = await createSearch({ query: query.trim(), location: location.trim() || undefined });
      onCreated(id);
      const result = await runSearch({ searchId: id });
      if (result.error) {
        toast.error(result.error);
      } else if (result.cached) {
        toast.info("Using cached results from the last 5 minutes.");
      } else {
        toast.success(`Found ${result.persisted} places.`);
      }
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border p-4 md:p-6 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px_auto] gap-3">
        <div className="relative">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Coffee shops, dental clinics, digital agencies…"
            className="w-full h-10 pl-10 pr-3 bg-transparent border border-border focus:border-foreground focus:outline-none text-sm"
          />
        </div>
        <div className="relative">
          <MapPin className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Location…"
            list="prospector-location-presets"
            className="w-full h-10 pl-10 pr-3 bg-transparent border border-border focus:border-foreground focus:outline-none text-sm"
          />
          <datalist id="prospector-location-presets">
            {LOCATION_PRESETS.map((loc) => (
              <option key={loc} value={loc} />
            ))}
          </datalist>
        </div>
        <Button
          onClick={submit}
          disabled={busy || query.trim().length < 3}
          className="h-10 px-6"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          Search
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Uses Google Places Text Search. Add your key at Settings → Integrations → Google Maps Places.
        </p>
        <a
          href={
            query.trim().length >= 2
              ? `https://www.google.com/maps/search/${encodeURIComponent(
                  query.trim() + (location.trim() ? " " + location.trim() : ""),
                )}`
              : `https://www.google.com/maps/`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-primary whitespace-nowrap"
          title="Browse this query on Google Maps in a new tab — free, no API needed"
        >
          <ExternalLink className="size-3" />
          Open on Google Maps
        </a>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground mr-1">
          Quick:
        </span>
        {QUICK_LOCATIONS.map((loc) => (
          <Button
            key={loc}
            type="button"
            variant={location === loc ? "default" : "outline"}
            size="sm"
            onClick={() => setLocation(loc)}
            className="h-6 px-2 text-[10px] font-mono"
          >
            {loc.replace(", Kenya", "").replace(", Nairobi", "")}
          </Button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results pane                                                          */
/* ------------------------------------------------------------------ */

function ResultsPane({ searchId }: { searchId: Id<"prospectorSearches"> }) {
  const search = useQuery(api.prospector.getSearch, { id: searchId });
  const [filter, setFilter] = useState<"all" | "unimported" | "imported">("unimported");
  const results = useQuery(api.prospector.listResults, {
    searchId,
    onlyUnimported: filter === "unimported",
    onlyImported: filter === "imported",
    limit: 200,
  });
  const [selected, setSelected] = useState<Set<Id<"prospectorResults">>>(new Set());
  const runSearch = useAction(api.prospectorActions.searchAndPersist);
  const importResult = useMutation(api.prospector.importResult);
  const bulkImport = useMutation(api.prospector.bulkImport);
  const rejectResult = useMutation(api.prospector.rejectResult);
  const rescoreSearch = useAction(api.prospectorAutoRank.rankSearchResultsPublic);
  const [runningMore, setRunningMore] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [drafterResultId, setDrafterResultId] = useState<Id<"prospectorResults"> | null>(null);

  const drafterTarget = useMemo(() => {
    if (!drafterResultId || !results) return null;
    return results.find((r) => r._id === drafterResultId) ?? null;
  }, [drafterResultId, results]);

  // Sort results by fit score desc (unscored fall to end).
  // AI scoring runs in the background after search — this ensures the
  // UI ranks itself as scores arrive.
  const sortedResults = useMemo(() => {
    if (!results) return results;
    return [...results].sort((a, b) => {
      const sa = typeof a.fitScore === "number" ? a.fitScore : -1;
      const sb = typeof b.fitScore === "number" ? b.fitScore : -1;
      if (sa === sb) return 0;
      return sb - sa; // desc
    });
  }, [results]);

  const unscoredCount = results?.filter((r) => typeof r.fitScore !== "number").length ?? 0;
  const scoredCount = results?.filter((r) => typeof r.fitScore === "number").length ?? 0;

  async function handleRescore() {
    setRescoring(true);
    try {
      const r = await rescoreSearch({ searchId });
      toast.success(`Scored ${r.ranked} results with AI.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setRescoring(false);
    }
  }

  async function loadMore() {
    if (!search?.nextPageToken) return;
    setRunningMore(true);
    try {
      const r = await runSearch({ searchId, pageToken: search.nextPageToken });
      if (r.error) toast.error(r.error);
      else toast.success(`+${r.persisted}`);
    } finally {
      setRunningMore(false);
    }
  }

  async function importAll() {
    if (selected.size === 0) return;
    try {
      const r = await bulkImport({ ids: Array.from(selected) });
      const parts: string[] = [];
      if (r.imported > 0) parts.push(`Imported ${r.imported}`);
      if (r.skipped > 0) parts.push(`${r.skipped} already imported`);
      if (r.skippedNoContact && r.skippedNoContact > 0) {
        parts.push(`${r.skippedNoContact} skipped — no phone/email/website`);
      }
      if (parts.length === 0) parts.push("Nothing changed");
      if (r.imported > 0) {
        toast.success(parts.join(" · "));
      } else if (r.skippedNoContact && r.skippedNoContact > 0) {
        toast.error(parts.join(" · "));
      } else {
        toast.info(parts.join(" · "));
      }
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  const toggle = (id: Id<"prospectorResults">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!results) return;
    const importable = results.filter(
      (r) =>
        !r.importedAt &&
        Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim()),
    );
    if (selected.size === importable.length) setSelected(new Set());
    else setSelected(new Set(importable.map((r) => r._id)));
  };

  if (!search) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display italic text-2xl">"{search.query}"</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {search.location} · {search.resultCount} found · {search.importedCount} imported
            {search.lastRunAt && (
              <> · {formatDistanceToNowStrict(new Date(search.lastRunAt), { addSuffix: true })}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {search.nextPageToken && (
            <Button
              onClick={loadMore}
              disabled={runningMore}
              variant="outline"
              size="sm"
              className="h-8 text-xs font-mono uppercase tracking-[0.12em]"
            >
              {runningMore ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              More
            </Button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-1 text-xs flex-wrap">
        <ToggleGroup
          value={[filter]}
          onValueChange={(v) => {
            const next = Array.isArray(v) ? v[v.length - 1] : v;
            if (next) setFilter(next as typeof filter);
          }}
          variant="default"
          size="sm"
          className="gap-0"
        >
          {(["unimported", "imported", "all"] as const).map((f) => (
            <ToggleGroupItem
              key={f}
              value={f}
              aria-label={`Filter ${f}`}
              className="px-3 h-7 uppercase tracking-[0.12em] font-mono text-xs"
            >
              {f}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {results && results.length > 0 && (
          <div className="ml-2 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
            {unscoredCount > 0 && !rescoring ? (
              <>
                <Loader2 className="size-3 animate-spin text-primary" />
                <span>
                  AI scoring… {scoredCount}/{results.length}
                </span>
              </>
            ) : scoredCount > 0 ? (
              <>
                <Sparkles className="size-3 text-primary" />
                <span>All {scoredCount} ranked · highest-fit first</span>
              </>
            ) : null}
            <Button
              onClick={handleRescore}
              disabled={rescoring}
              title="Re-score every result with AI"
              variant="outline"
              size="sm"
              className="ml-1 h-6 px-1.5 text-[10px] uppercase tracking-[0.12em]"
            >
              {rescoring ? (
                <Loader2 className="size-2.5 animate-spin" />
              ) : (
                <RefreshCw className="size-2.5" />
              )}
              Rescore
            </Button>
          </div>
        )}
        {selected.size > 0 && (
          <Button
            onClick={importAll}
            size="sm"
            className="ml-auto h-7 text-xs font-mono uppercase tracking-[0.12em]"
          >
            <Check className="size-3" />
            Import {selected.size}
          </Button>
        )}
      </div>

      {sortedResults === undefined ? (
        <ResultsSkeleton />
      ) : sortedResults.length === 0 ? (
        <div className="border border-border p-8 text-center text-sm text-muted-foreground">
          {filter === "unimported"
            ? "Everything imported already."
            : filter === "imported"
              ? "Nothing imported yet."
              : "No results."}
        </div>
      ) : (
        <>
          {filter === "unimported" && sortedResults.length >= 4 && (
            <div className="mb-4">
              <AgentPicksBar
                actionRef={api.pageAgents.rankProspectorPicks}
                actionArgs={{ searchId }}
                title="AI · Import these first"
                emptyLabel="No standout prospects to prioritise."
                autoRun={false}
                renderTitle={(r) => {
                  const rec = r as { name?: string; category?: string; fitScore?: number };
                  const bits = [rec.name];
                  if (rec.category) bits.push(rec.category);
                  if (typeof rec.fitScore === "number") bits.push(`fit ${rec.fitScore}`);
                  return bits.filter(Boolean).join(" · ");
                }}
                renderPrimaryAction={(_r, pick) => ({
                  label: "Draft outreach",
                  onClick: () => setDrafterResultId(pick.id as Id<"prospectorResults">),
                })}
              />
            </div>
          )}
        <div className="border border-border divide-y divide-border">
          {filter === "unimported" && (
            <div className="px-4 h-9 flex items-center bg-muted/30">
              <Checkbox
                checked={
                  sortedResults.filter(
                    (r) =>
                      !r.importedAt &&
                      Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim()),
                  ).length > 0 &&
                  selected.size ===
                    sortedResults.filter(
                      (r) =>
                        !r.importedAt &&
                        Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim()),
                    ).length
                }
                onCheckedChange={toggleAll}
              />
              <span className="ml-3 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </div>
          )}
          {sortedResults.map((r) => (
            <ResultRow
              key={r._id}
              r={r}
              selected={selected.has(r._id)}
              onToggle={() => toggle(r._id)}
              onImport={async () => {
                try {
                  const res = await importResult({ id: r._id });
                  toast.success(res.alreadyImported ? "Already in your CRM." : "Imported.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                }
              }}
              onDraft={() => setDrafterResultId(r._id)}
              onReject={async () => {
                if (!confirm(`Reject "${r.name}" and never see it again?`)) return;
                await rejectResult({ id: r._id });
                toast.success("Rejected.");
              }}
            />
          ))}
        </div>
        </>
      )}
      {drafterTarget && (
        <OutreachDrafter
          resultId={drafterTarget._id}
          companyName={drafterTarget.name}
          hasEmail={Boolean(drafterTarget.email?.trim())}
          hasPhone={Boolean(drafterTarget.phone?.trim())}
          primaryEmail={drafterTarget.email}
          primaryPhone={drafterTarget.phone}
          open={drafterResultId !== null}
          onOpenChange={(o) => !o && setDrafterResultId(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result row                                                            */
/* ------------------------------------------------------------------ */

function ResultRow({
  r, selected, onToggle, onImport, onDraft, onReject,
}: {
  r: Doc<"prospectorResults">;
  selected: boolean;
  onToggle: () => void;
  onImport: () => void;
  onDraft: () => void;
  onReject: () => void;
}) {
  const imported = r.importedAt !== undefined;
  const reachable = Boolean(r.phone?.trim() || r.email?.trim() || r.website?.trim());
  const scoreLead = useAction(api.aiWorkflows.scoreLeadFit);
  const enrichWebsite = useAction(api.aiWorkflows.enrichWebsite);
  const [aiBusy, setAiBusy] = useState<"score" | "enrich" | null>(null);

  async function handleScore() {
    setAiBusy("score");
    try {
      const res = await scoreLead({ resultId: r._id });
      toast.success(`Fit: ${res.score}/100`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI scoring failed.");
    } finally {
      setAiBusy(null);
    }
  }

  async function handleEnrich() {
    if (!r.website) {
      toast.error("No website — nothing to enrich.");
      return;
    }
    setAiBusy("enrich");
    try {
      const res = await enrichWebsite({ resultId: r._id });
      if (res.error) toast.error(`Enrichment: ${res.error}`);
      else if (res.email || res.phone) {
        toast.success(`Found: ${res.email ?? ""}${res.phone ? " · " + res.phone : ""}`);
      } else toast.info("Website fetched but no contact info found.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enrichment failed.");
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <div className={cn("px-4 py-4 flex items-start gap-4", imported && "opacity-70", !reachable && !imported && "opacity-60")}>
      {!imported && (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!reachable}
          aria-label={`Select ${r.name}`}
        />
      )}
      {imported && <Check className="size-4 text-[var(--success)] mt-0.5" />}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline gap-3 justify-between">
          <p className="font-medium text-sm truncate">{r.name}</p>
          <div className="flex items-center gap-2 shrink-0">
            {!reachable && !imported && (
              <span
                title="No phone, email, or website — can't cold outreach"
                className="text-[9px] font-mono uppercase tracking-[0.12em] border border-[var(--warning)]/60 text-[var(--warning)] px-1.5 py-0.5"
              >
                No contact
              </span>
            )}
            {typeof r.fitScore === "number" && (
              <span
                title={r.fitReasoning}
                className={cn(
                  "text-[10px] font-mono uppercase tracking-[0.12em] border px-1.5 py-0.5",
                  r.fitScore >= 70
                    ? "border-[var(--success)] text-[var(--success)]"
                    : r.fitScore >= 40
                      ? "border-[var(--warning)] text-[var(--warning)]"
                      : "border-border text-muted-foreground",
                )}
              >
                {r.fitScore}
              </span>
            )}
            {r.rating && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 num">
                <Star className="size-3 fill-[var(--warning)] text-[var(--warning)]" />
                {r.rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        {r.address && (
          <p className="text-xs text-muted-foreground truncate">{r.address}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {(r.phone) && (
            <span className="flex items-center gap-1 num">
              <Phone className="size-3" />
              {r.phone}
            </span>
          )}
          {r.email && (
            <span className="text-primary">{r.email}</span>
          )}
          {r.website && (
            <a
              href={r.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Globe className="size-3" />
              {domainOf(r.website)}
            </a>
          )}
          {r.types && r.types.slice(0, 2).map((t) => (
            <span key={t} className="text-muted-foreground/70 text-[10px]">
              {t.replace(/_/g, " ")}
            </span>
          ))}
          {r.googleMapsUri && (
            <a
              href={r.googleMapsUri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
            >
              <ExternalLink className="size-3" />
              Maps
            </a>
          )}
        </div>
        {r.fitReasoning && (
          <p className="text-[11px] text-muted-foreground italic line-clamp-2">
            {r.fitReasoning}
          </p>
        )}
      </div>
      {!imported && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            onClick={handleScore}
            disabled={aiBusy !== null}
            title="AI fit score"
            variant="ghost"
            size="icon-sm"
          >
            {aiBusy === "score" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          </Button>
          <Button
            onClick={handleEnrich}
            disabled={aiBusy !== null || !r.website}
            title="AI enrich from website"
            variant="ghost"
            size="icon-sm"
          >
            {aiBusy === "enrich" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          </Button>
          <Button
            onClick={onReject}
            title="Reject — suppress from future searches"
            variant="ghost"
            size="icon-sm"
            className="hover:text-[var(--danger)]"
          >
            <X className="size-3.5" />
          </Button>
          <Button
            onClick={onImport}
            disabled={!reachable}
            title={reachable ? "Import as company" : "No contact info — cannot import"}
            variant="ghost"
            size="icon-sm"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            onClick={onDraft}
            disabled={!reachable}
            title={reachable ? "Draft outreach with AI" : "No contact info — cannot draft"}
            variant="ghost"
            size="icon-sm"
          >
            <Sparkles className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="border border-border divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-4 flex items-center gap-4">
          <Skeleton className="size-4" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
