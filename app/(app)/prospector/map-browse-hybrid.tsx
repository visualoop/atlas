"use client";

import "leaflet/dist/leaflet.css";

/**
 * MapBrowseHybrid — the best of both worlds when the founder has only
 * Google's Places API enabled (not Maps JavaScript API).
 *
 * Rendering: Leaflet + OpenStreetMap tiles (free forever, no key)
 * Business data: Google Places API via our server-side searchNearby
 *
 * Result: same rich business data (ratings, phone, opening hours) as
 * Google's own map without needing the Maps JS API subscription. The
 * only Google API call cost is the Places API itself, which sits under
 * Google's $200/month free credit for the first ~11,700 nearby calls.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import Link from "next/link";
import {
  Search, Loader2, MapPin, ExternalLink, Check, Building2,
  Phone, Globe, X, Star, Info,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WhatsAppOpenChat } from "@/components/atlas/whatsapp-open-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Place {
  googlePlaceId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phoneRaw?: string;
  website?: string;
  googleMapsUri?: string;
  types?: string[];
  rating?: number;
  ratingCount?: number;
  businessStatus?: string;
}

const CATEGORIES = [
  { value: "restaurant", label: "Food + drink" },
  { value: "retail", label: "Retail" },
  { value: "services", label: "Services" },
  { value: "health", label: "Health" },
  { value: "auto", label: "Auto" },
  { value: "hotel", label: "Hotel" },
  { value: "office", label: "Office" },
];

const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];
const DEFAULT_ZOOM = 13;

export function MapBrowseHybrid() {
  const searchNearbyGoogle = useAction(api.prospectorActions.searchNearby);
  const importOne = useAction(api.prospectorActions.importOneFromMap);
  const bulkImport = useMutation(api.prospector.bulkImportMapPlaces);
  const rankProspects = useAction(api.prospectorRanking.rankProspects);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [category, setCategory] = useState<string>("retail");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());
  const [importN, setImportN] = useState(10);
  const [ranking, setRanking] = useState(false);
  const [scoresById, setScoresById] = useState<Record<string, { fitScore: number; fitReason: string }>>({});
  const [hideBadFit, setHideBadFit] = useState(false);

  const budget = useQuery(api.prospector.getImportBudget, {});
  const mapsUsage = useQuery(api.apiUsage.getMapsUsageToday, {});
  const dedup = useQuery(
    api.prospector.checkMapPlaces,
    places.length > 0 ? { googlePlaceIds: places.map((p) => p.googlePlaceId) } : "skip",
  );

  useEffect(() => {
    if (!dedup) return;
    setImportedIds((prev) => new Set([...prev, ...dedup.imported]));
    setSuppressedIds(new Set(dedup.suppressed));
  }, [dedup]);

  // Initialize Leaflet map
  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current || !mapContainerRef.current) return;

    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      // CSS is bundled — see top of file — no runtime CDN injection needed.
      if (cancelled || !mapContainerRef.current) return;
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const layerGroup = L.layerGroup().addTo(map);
      mapRef.current = map;
      markersLayerRef.current = layerGroup;
      setLeafletReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!leafletReady || !markersLayerRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !markersLayerRef.current) return;
      markersLayerRef.current.clearLayers();
      for (const p of places) {
        if (typeof p.latitude !== "number" || typeof p.longitude !== "number") continue;
        const isImported = importedIds.has(p.googlePlaceId);
        const isSuppressed = suppressedIds.has(p.googlePlaceId);
        const color = isSuppressed
          ? "#B45309"
          : isImported
          ? "#78716C"
          : selected?.googlePlaceId === p.googlePlaceId
          ? "#059669"
          : "#0A0A0B";
        const icon = L.divIcon({
          className: "",
          iconSize: [18, 18],
          iconAnchor: [9, 18],
          html: `<div style="width:18px;height:18px;border-radius:0;background:${color};border:2px solid #F4F2EE;box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div>`,
        });
        const marker = L.marker([p.latitude, p.longitude], { icon, title: p.name });
        marker.on("click", () => setSelected(p));
        marker.addTo(markersLayerRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leafletReady, places, selected, importedIds, suppressedIds]);

  async function searchThisArea() {
    if (!leafletReady || !mapRef.current) return;
    const center = mapRef.current.getCenter();
    const bounds = mapRef.current.getBounds();
    const R = 6_371_000;
    const dLat = ((bounds.getNorth() - center.lat) * Math.PI) / 180;
    const dLng = ((bounds.getEast() - center.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((center.lat * Math.PI) / 180) *
        Math.cos((bounds.getNorth() * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const radius = Math.min(50_000, R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.7);

    setBusy(true);
    try {
      const res = await searchNearbyGoogle({
        latitude: center.lat,
        longitude: center.lng,
        radiusMeters: Math.round(radius),
        category: category || undefined,
        useLegacy: false,
        nameKeyword: keyword.trim() || undefined,
      });
      if (res.error) {
        toast.error(res.error);
        setPlaces([]);
      } else {
        setScoresById({});
        setPlaces(res.places);
        if (res.places.length === 0) {
          toast.info("No businesses found in this area — pan and try again.");
        } else {
          void rankNow(res.places);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importPlace(p: Place) {
    try {
      const r = await importOne({
        googlePlaceId: p.googlePlaceId,
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        phoneRaw: p.phoneRaw,
        website: p.website,
        googleMapsUri: p.googleMapsUri,
        types: p.types,
        rating: p.rating,
        ratingCount: p.ratingCount,
      });
      setImportedIds((s) => new Set([...s, p.googlePlaceId]));
      toast.success(r.duplicated ? "Already in your CRM." : "Imported into Companies.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    }
  }

  async function rankNow(list: Place[]) {
    setRanking(true);
    try {
      const res = await rankProspects({
        places: list.map((p) => ({
          googlePlaceId: p.googlePlaceId,
          name: p.name,
          address: p.address,
          types: p.types,
          rating: p.rating,
          ratingCount: p.ratingCount,
          hasPhone: Boolean(p.phoneRaw?.trim()),
          hasWebsite: Boolean(p.website?.trim()),
        })),
      });
      const map: Record<string, { fitScore: number; fitReason: string }> = {};
      for (const s of res.scores) {
        map[s.googlePlaceId] = { fitScore: s.fitScore, fitReason: s.fitReason };
      }
      setScoresById(map);
      if (res.error === "no_workspace_context") {
        toast.info("Fill in Settings → Workspace so the AI can score fit properly.");
      }
    } catch {
      // silent — leave results unranked
    } finally {
      setRanking(false);
    }
  }

  const candidates = useMemo(
    () =>
      places
        .filter((p) => !importedIds.has(p.googlePlaceId) && !suppressedIds.has(p.googlePlaceId))
        .sort((a, b) => {
          const sa = scoresById[a.googlePlaceId]?.fitScore ?? 50;
          const sb = scoresById[b.googlePlaceId]?.fitScore ?? 50;
          if (sa !== sb) return sb - sa;
          return (b.rating ?? 0) - (a.rating ?? 0);
        }),
    [places, importedIds, suppressedIds, scoresById],
  );

  const sortedPlaces = useMemo(
    () =>
      [...places]
        .filter((p) => {
          if (!hideBadFit) return true;
          const s = scoresById[p.googlePlaceId]?.fitScore;
          if (typeof s !== "number") return true;
          return s >= 25;
        })
        .sort((a, b) => {
          const sa = scoresById[a.googlePlaceId]?.fitScore ?? 50;
          const sb = scoresById[b.googlePlaceId]?.fitScore ?? 50;
          if (sa !== sb) return sb - sa;
          return (b.rating ?? 0) - (a.rating ?? 0);
        }),
    [places, scoresById, hideBadFit],
  );

  const hiddenCount = useMemo(
    () =>
      places.filter((p) => {
        const s = scoresById[p.googlePlaceId]?.fitScore;
        return typeof s === "number" && s < 25;
      }).length,
    [places, scoresById],
  );

  async function bulkImportTopN() {
    if (candidates.length === 0) {
      toast.info("Nothing new to import in this view.");
      return;
    }
    const remaining = budget?.remaining ?? 100;
    const n = Math.min(importN, candidates.length, remaining);
    if (n === 0) {
      toast.error("Daily import cap reached.");
      return;
    }
    setBusy(true);
    try {
      const picks = candidates.slice(0, n);
      const res = await bulkImport({ places: picks });
      setImportedIds(
        (s) => new Set([...s, ...picks.slice(0, res.imported).map((p) => p.googlePlaceId)]),
      );
      toast.success(`Imported ${res.imported}${res.skippedDuplicate ? ` · ${res.skippedDuplicate} already there` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-0 border border-border h-[calc(100vh-14rem)] max-h-[900px]">
      <div className="relative bg-muted min-h-[50vh] lg:min-h-0">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Controls — mobile-first stacked with backdrop */}
        <div className="absolute top-2 left-2 right-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 z-[400]">
          <Select value={category} onValueChange={(v) => v && setCategory(v)}>
            <SelectTrigger size="sm" className="h-9 bg-background shadow">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) searchThisArea();
            }}
            placeholder="Keyword (pharmacy, salon…)"
            className="h-9 bg-background shadow flex-1 min-w-0"
          />
          <Button
            onClick={searchThisArea}
            disabled={!leafletReady || busy || (mapsUsage && mapsUsage.remaining === 0)}
            className="h-9 text-xs font-mono uppercase tracking-[0.12em] shadow whitespace-nowrap"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            {mapsUsage && mapsUsage.remaining === 0 ? "Cap hit" : "Search this area"}
          </Button>
          {mapsUsage && (
            <span
              className={cn(
                "text-[10px] font-mono uppercase tracking-[0.12em] bg-background border border-border px-2 h-9 grid place-items-center shadow whitespace-nowrap sm:ml-auto",
                mapsUsage.remaining <= 10 && "text-[var(--warning)]",
                mapsUsage.remaining === 0 && "text-[var(--destructive)] border-[var(--destructive)]",
              )}
              title="Google Places API calls today — hard-capped to stay free"
            >
              {mapsUsage.remaining}/{mapsUsage.cap} left today
            </span>
          )}
        </div>

        <div className="absolute bottom-2 left-2 z-[400] text-[10px] font-mono text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 flex items-center gap-1.5">
          <Info className="size-3" />
          OSM tiles + Google Places data · no Maps JS API needed
        </div>

        {!leafletReady && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      <aside className="border-l border-border flex flex-col overflow-hidden">
        {selected ? (
          <PlaceDetail
            place={selected}
            imported={importedIds.has(selected.googlePlaceId)}
            onClose={() => setSelected(null)}
            onImport={() => importPlace(selected)}
          />
        ) : places.length === 0 ? (
          <div className="p-6 space-y-3 text-center">
            <MapPin className="size-8 text-muted-foreground mx-auto" />
            <p className="font-display italic text-xl text-muted-foreground">
              Pan the map, hit "Search this area".
            </p>
            <p className="text-xs text-muted-foreground">
              Google Places data on free OpenStreetMap tiles. Rich business info
              (rating, phone, website) without needing the Maps JavaScript API.
            </p>
            {budget && (
              <p className="text-[11px] font-mono text-muted-foreground pt-2">
                {budget.remaining} / {budget.dailyCap} imports left today
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 border-b border-border space-y-2 sticky top-0 bg-background z-10">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="eyebrow">
                  {sortedPlaces.length} result{sortedPlaces.length === 1 ? "" : "s"}
                  {ranking && <span className="text-primary"> · AI ranking…</span>}
                  {hiddenCount > 0 && (
                    <span className="text-muted-foreground">
                      {" "}· {hiddenCount} low-fit hidden
                    </span>
                  )}
                  {importedIds.size > 0 && (
                    <span className="text-muted-foreground">
                      {" "}· {places.filter((p) => importedIds.has(p.googlePlaceId)).length} already
                      yours
                    </span>
                  )}
                </p>
                {budget && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {budget.remaining}/{budget.dailyCap} left today
                  </p>
                )}
              </div>
              {hiddenCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHideBadFit((v) => !v)}
                  className="h-auto px-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground self-start"
                >
                  {hideBadFit ? "Show" : "Hide"} low-fit ({hiddenCount})
                </Button>
              )}
              {candidates.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted-foreground">Top</span>
                  <Input
                    type="number"
                    min={1}
                    max={Math.min(candidates.length, budget?.remaining ?? 100)}
                    value={importN}
                    onChange={(e) =>
                      setImportN(Math.max(1, Math.min(candidates.length, Number(e.target.value) || 1)))
                    }
                    className="w-14 h-7 px-2 text-xs font-mono num"
                  />
                  <span className="text-[11px] text-muted-foreground">by fit</span>
                  <Button
                    onClick={bulkImportTopN}
                    disabled={busy}
                    size="sm"
                    className="ml-auto h-7 text-[10px] font-mono uppercase tracking-[0.12em]"
                  >
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <Building2 className="size-3" />}
                    Import
                  </Button>
                </div>
              )}
            </div>
            <div className="divide-y divide-border">
              {sortedPlaces.map((p) => {
                const score = scoresById[p.googlePlaceId];
                return (
                <button
                  key={p.googlePlaceId}
                  onClick={() => setSelected(p)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors",
                    importedIds.has(p.googlePlaceId) && "opacity-60",
                    suppressedIds.has(p.googlePlaceId) && "opacity-40",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    {score && <FitScorePill score={score.fitScore} />}
                    {importedIds.has(p.googlePlaceId) && (
                      <Check className="size-3.5 text-[var(--success)] shrink-0" />
                    )}
                  </div>
                  {p.address && (
                    <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground mt-0.5">
                    {typeof p.rating === "number" && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="size-2.5 fill-current" /> {p.rating}
                      </span>
                    )}
                    {typeof p.ratingCount === "number" && <span>({p.ratingCount})</span>}
                  </div>
                  {score && score.fitReason && (
                    <p className="text-[11px] italic text-muted-foreground mt-0.5 line-clamp-2">
                      {score.fitReason}
                    </p>
                  )}
                </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function FitScorePill({ score }: { score: number }) {
  const styles =
    score >= 80
      ? "text-[var(--success)] border-[var(--success)]"
      : score >= 55
      ? "text-[var(--warning)] border-[var(--warning)]"
      : "text-muted-foreground border-border";
  return (
    <span
      className={cn("text-[10px] font-mono border px-1 py-[1px] shrink-0", styles)}
      title="AI fit score against your workspace's ideal customer"
    >
      {score}
    </span>
  );
}

function PlaceDetail({
  place: p, imported, onClose, onImport,
}: {
  place: Place;
  imported: boolean;
  onClose: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-4 py-3 border-b border-border flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="eyebrow">Business · Google Places</p>
          <p className="text-lg font-medium mt-1">{p.name}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="px-4 py-4 space-y-3 text-sm">
        {p.address && (
          <div className="flex items-start gap-2">
            <MapPin className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{p.address}</span>
          </div>
        )}
        {p.phoneRaw && (
          <div className="flex items-start gap-2">
            <Phone className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 flex items-center justify-between gap-2 flex-wrap">
              <a href={`tel:${p.phoneRaw}`} className="text-primary hover:underline font-mono num">
                {p.phoneRaw}
              </a>
              <WhatsAppOpenChat phone={p.phoneRaw} label="Chat" size="sm" />
            </div>
          </div>
        )}
        {p.website && (
          <div className="flex items-start gap-2">
            <Globe className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline truncate"
            >
              {p.website.replace(/^https?:\/\//, "")}
            </a>
          </div>
        )}
        {typeof p.rating === "number" && (
          <div className="flex items-start gap-2">
            <Star className="size-3.5 text-[var(--warning)] shrink-0 fill-current mt-0.5" />
            <span className="text-muted-foreground">
              {p.rating.toFixed(1)}
              {typeof p.ratingCount === "number" && ` · ${p.ratingCount} review${p.ratingCount === 1 ? "" : "s"}`}
            </span>
          </div>
        )}
        {p.googleMapsUri && (
          <a
            href={p.googleMapsUri}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1 h-9 px-3 text-xs font-mono uppercase tracking-[0.12em] border border-border hover:border-foreground mt-2"
          >
            <ExternalLink className="size-3.5" />
            View on Google Maps
          </a>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <Button
          onClick={onImport}
          disabled={imported}
          size="lg"
          variant={imported ? "secondary" : "default"}
          className="w-full h-10 text-xs font-mono uppercase tracking-[0.12em]"
        >
          {imported ? <Check className="size-3.5" /> : <Building2 className="size-3.5" />}
          {imported ? "Imported to Companies" : "Import to Companies"}
        </Button>
      </div>
    </div>
  );
}
