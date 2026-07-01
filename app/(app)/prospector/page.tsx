"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Search, MapPin, Star, ExternalLink, Loader2, Phone, Globe,
  Check, X, Trash2, ChevronRight, RefreshCw, Sparkles, Zap, Map as MapIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { MapBrowse } from "./map-browse";

export default function ProspectorPage() {
  const searches = useQuery(api.prospector.listSearches, {});
  const [activeSearchId, setActiveSearchId] = useState<Id<"prospectorSearches"> | null>(null);
  const [mode, setMode] = useState<"search" | "map">("search");

  // Auto-select the newest search
  const derivedActive = activeSearchId ?? searches?.[0]?._id ?? null;

  return (
    <div className="max-w-7xl mx-auto px-8 py-12">
      <header className="space-y-2 mb-10">
        <p className="eyebrow">Prospector</p>
        <h1 className="text-4xl md:text-5xl tracking-tight">
          Turn any query <em className="italic font-display">into leads</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Powered by Google Places. Search for businesses, then import the
          ones you want into your CRM as companies. Rejected leads are
          suppressed on future runs so you never see them twice.
        </p>
      </header>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        <TabButton active={mode === "search"} onClick={() => setMode("search")} icon={Search} label="Text search" />
        <TabButton active={mode === "map"} onClick={() => setMode("map")} icon={MapIcon} label="Map browse" />
        <span className="ml-auto text-[11px] text-muted-foreground italic self-center pb-2">
          {mode === "search" ? "AI-driven query" : "Pan + pick yourself"}
        </span>
      </div>

      {mode === "map" ? (
        <MapBrowse />
      ) : (
        <>
      <NewSearchForm
        onCreated={(id) => setActiveSearchId(id)}
      />

      <div className="mt-10 grid grid-cols-[280px_1fr] gap-8">
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
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
        active
          ? "text-foreground border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground hover:border-primary/40",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
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
            className="w-full h-10 pl-10 pr-3 bg-transparent border border-border focus:border-foreground focus:outline-none text-sm"
          />
        </div>
        <button
          onClick={submit}
          disabled={busy || query.trim().length < 3}
          className={cn(
            "inline-flex items-center gap-2 h-10 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          Search
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Uses Google Places Text Search. Add your key in Settings → Integrations → Google Maps Places.
      </p>
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
  const [runningMore, setRunningMore] = useState(false);

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
      toast.success(`Imported ${r.imported}, skipped ${r.skipped}.`);
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
    const unimported = results.filter((r) => !r.importedAt);
    if (selected.size === unimported.length) setSelected(new Set());
    else setSelected(new Set(unimported.map((r) => r._id)));
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
            <button
              onClick={loadMore}
              disabled={runningMore}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {runningMore ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              More
            </button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-1 text-xs">
        {(["unimported", "imported", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 h-7 uppercase tracking-[0.12em] font-mono transition-colors",
              filter === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
        {selected.size > 0 && (
          <button
            onClick={importAll}
            className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
          >
            <Check className="size-3" />
            Import {selected.size}
          </button>
        )}
      </div>

      {results === undefined ? (
        <ResultsSkeleton />
      ) : results.length === 0 ? (
        <div className="border border-border p-8 text-center text-sm text-muted-foreground">
          {filter === "unimported"
            ? "Everything imported already."
            : filter === "imported"
              ? "Nothing imported yet."
              : "No results."}
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {filter === "unimported" && (
            <div className="px-4 h-9 flex items-center bg-muted/30">
              <Checkbox
                checked={
                  results.filter((r) => !r.importedAt).length > 0 &&
                  selected.size === results.filter((r) => !r.importedAt).length
                }
                onCheckedChange={toggleAll}
              />
              <span className="ml-3 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </div>
          )}
          {results.map((r) => (
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
              onReject={async () => {
                if (!confirm(`Reject "${r.name}" and never see it again?`)) return;
                await rejectResult({ id: r._id });
                toast.success("Rejected.");
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result row                                                            */
/* ------------------------------------------------------------------ */

function ResultRow({
  r, selected, onToggle, onImport, onReject,
}: {
  r: Doc<"prospectorResults">;
  selected: boolean;
  onToggle: () => void;
  onImport: () => void;
  onReject: () => void;
}) {
  const imported = r.importedAt !== undefined;
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
    <div className={cn("px-4 py-4 flex items-start gap-4", imported && "opacity-70")}>
      {!imported && (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${r.name}`}
        />
      )}
      {imported && <Check className="size-4 text-[var(--success)] mt-0.5" />}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline gap-3 justify-between">
          <p className="font-medium text-sm truncate">{r.name}</p>
          <div className="flex items-center gap-2 shrink-0">
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
          <button
            onClick={handleScore}
            disabled={aiBusy !== null}
            title="AI fit score"
            className="size-8 grid place-items-center text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-50"
          >
            {aiBusy === "score" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          </button>
          <button
            onClick={handleEnrich}
            disabled={aiBusy !== null || !r.website}
            title="AI enrich from website"
            className="size-8 grid place-items-center text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-30"
          >
            {aiBusy === "enrich" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          </button>
          <button
            onClick={onReject}
            title="Reject — suppress from future searches"
            className="size-8 grid place-items-center text-muted-foreground hover:text-[var(--danger)] hover:bg-muted transition-colors"
          >
            <X className="size-3.5" />
          </button>
          <button
            onClick={onImport}
            title="Import as company"
            className="size-8 grid place-items-center text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
          >
            <Check className="size-3.5" />
          </button>
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
