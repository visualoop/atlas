"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import Link from "next/link";
import {
  Search, Loader2, MapPin, ExternalLink, Check, Star, Building2,
  Phone, Globe, X, KeyRound,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WhatsAppOpenChat } from "@/components/atlas/whatsapp-open-chat";

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

// Nairobi CBD default
const DEFAULT_CENTER = { lat: -1.2864, lng: 36.8172 };
const DEFAULT_ZOOM = 13;

export function MapBrowse() {
  const mapsKey = useQuery(api.prospector.getMapsClientKey, {});
  const searchNearby = useAction(api.prospectorActions.searchNearby);
  const importOne = useAction(api.prospectorActions.importOneFromMap);
  const bulkImport = useMutation(api.prospector.bulkImportMapPlaces);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());
  const [importN, setImportN] = useState(10);

  // Preflight check: how many can we still import today?
  const budget = useQuery(api.prospector.getImportBudget, {});
  // Daily Google Maps API call budget (separate from imports)
  const mapsUsage = useQuery(api.apiUsage.getMapsUsageToday, {});
  // Preflight check: which of the currently-visible places are already
  // imported or suppressed in this workspace?
  const dedup = useQuery(
    api.prospector.checkMapPlaces,
    places.length > 0
      ? { googlePlaceIds: places.map((p) => p.googlePlaceId) }
      : "skip",
  );

  useEffect(() => {
    if (!dedup) return;
    setImportedIds((prev) => new Set([...prev, ...dedup.imported]));
    setSuppressedIds(new Set(dedup.suppressed));
  }, [dedup]);

  // Load the Maps JS SDK once we have a key
  useEffect(() => {
    if (!mapsKey?.key || !mapRef.current || mapInstanceRef.current) return;
    setOptions({
      key: mapsKey.key,
      v: "weekly",
    });
    (async () => {
      const [{ Map }] = await Promise.all([
        importLibrary("maps"),
        importLibrary("marker"),
        importLibrary("places"),
      ]);
      if (!mapRef.current) return;
      const map = new Map(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapId: "atlas-prospector",
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      mapInstanceRef.current = map;
      setReady(true);
    })();
  }, [mapsKey?.key]);

  // Sync markers when places change
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear existing markers
    for (const m of markersRef.current) {
      m.map = null;
    }
    markersRef.current = [];

    // Load AdvancedMarkerElement
    (async () => {
      const { AdvancedMarkerElement, PinElement } = (await importLibrary(
        "marker",
      )) as google.maps.MarkerLibrary;

      for (const p of places) {
        if (typeof p.latitude !== "number" || typeof p.longitude !== "number") continue;
        const isImported = importedIds.has(p.googlePlaceId);
        const isSuppressed = suppressedIds.has(p.googlePlaceId);
        const pinBg = isSuppressed
          ? "#B45309" // amber-800 for suppressed
          : isImported
          ? "#78716C" // stone-500 for already imported
          : selected?.googlePlaceId === p.googlePlaceId
          ? "#059669" // emerald primary
          : "#0A0A0B"; // ink for candidates
        const pin = new PinElement({
          background: pinBg,
          borderColor: "#F4F2EE",
          glyphColor: "#F4F2EE",
          scale: selected?.googlePlaceId === p.googlePlaceId ? 1.25 : 1.0,
        });
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: p.latitude, lng: p.longitude },
          title: p.name,
          content: pin.element,
        });
        marker.addListener("click", () => setSelected(p));
        markersRef.current.push(marker);
      }
    })();
  }, [ready, places, selected, importedIds, suppressedIds]);

  async function searchThisArea() {
    if (!ready || !mapInstanceRef.current) return;
    const center = mapInstanceRef.current.getCenter();
    if (!center) return;

    // Compute effective radius from visible bounds
    const bounds = mapInstanceRef.current.getBounds();
    let radius = 3000;
    if (bounds) {
      const ne = bounds.getNorthEast();
      const c = center;
      const R = 6_371_000;
      const dLat = ((ne.lat() - c.lat()) * Math.PI) / 180;
      const dLng = ((ne.lng() - c.lng()) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((c.lat() * Math.PI) / 180) *
          Math.cos((ne.lat() * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      radius = Math.min(50_000, R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.7);
    }

    setBusy(true);
    try {
      const res = await searchNearby({
        latitude: center.lat(),
        longitude: center.lng(),
        radiusMeters: Math.round(radius),
        category: category || undefined,
      });
      if (res.error) {
        toast.error(res.error);
        setPlaces([]);
      } else {
        setPlaces(res.places);
        if (res.places.length === 0) {
          toast.info("No businesses found in this area — pan and try again.");
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

  // Places that haven't been imported/suppressed yet, sorted by rating desc
  const candidates = useMemo(
    () =>
      places
        .filter(
          (p) => !importedIds.has(p.googlePlaceId) && !suppressedIds.has(p.googlePlaceId),
        )
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
    [places, importedIds, suppressedIds],
  );

  async function bulkImportTopN() {
    if (candidates.length === 0) {
      toast.info("Nothing new to import in this view.");
      return;
    }
    const remaining = budget?.remaining ?? 100;
    const n = Math.min(importN, candidates.length, remaining);
    if (n === 0) {
      toast.error("Daily import cap reached. Bump it in Settings → Workspace.");
      return;
    }
    setBusy(true);
    try {
      const picks = candidates.slice(0, n);
      const res = await bulkImport({ places: picks });
      // Reflect in local state
      setImportedIds((s) => new Set([...s, ...picks.slice(0, res.imported).map((p) => p.googlePlaceId)]));
      toast.success(
        `Imported ${res.imported}${res.skippedDuplicate ? ` · ${res.skippedDuplicate} already there` : ""}${res.capReached ? ` · daily cap hit` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk import failed.");
    } finally {
      setBusy(false);
    }
  }

  // No key configured
  if (mapsKey && !mapsKey.key) {
    return (
      <div className="border border-dashed border-border p-10 text-center space-y-4">
        <KeyRound className="size-8 text-primary mx-auto" />
        <p className="font-display italic text-2xl text-muted-foreground">
          Add a Google Maps key to browse.
        </p>
        <p className="text-sm text-muted-foreground max-w-prose mx-auto">
          Enable the <strong>Places API (New)</strong> in Google Cloud, generate a
          key restricted to <code className="font-mono">atlas.blyss.co.ke</code>,
          and paste it in Settings → Integrations → Google Maps Places.
        </p>
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1.5 h-9 px-5 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em]"
        >
          Add key
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_380px] gap-0 border border-border" style={{ height: "70vh" }}>
      {/* Map */}
      <div className="relative bg-muted">
        <div ref={mapRef} className="absolute inset-0" />
        {/* Overlay controls */}
        <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-10 flex-wrap">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 px-3 text-sm bg-background border border-border shadow"
          >
            <option value="">All businesses</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={searchThisArea}
            disabled={!ready || busy || (mapsUsage && mapsUsage.remaining === 0)}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            {mapsUsage && mapsUsage.remaining === 0 ? "Daily cap hit" : "Search this area"}
          </button>
          {mapsUsage && (
            <span
              className={cn(
                "text-[10px] font-mono uppercase tracking-[0.12em] bg-background border border-border px-2 h-9 grid place-items-center shadow",
                mapsUsage.remaining <= 10 && "text-[var(--warning)]",
                mapsUsage.remaining === 0 && "text-[var(--destructive)] border-[var(--destructive)]",
              )}
              title="Google Maps API calls today — hard-capped to keep you inside free tier"
            >
              {mapsUsage.remaining} / {mapsUsage.cap} left
            </span>
          )}
        </div>
        {!ready && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Sidebar */}
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
              Pins appear for every business in view. Click one to import.
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
              <div className="flex items-baseline justify-between gap-2">
                <p className="eyebrow">
                  {places.length} result{places.length === 1 ? "" : "s"}
                  {importedIds.size > 0 && (
                    <span className="text-muted-foreground">
                      {" "}· {places.filter((p) => importedIds.has(p.googlePlaceId)).length} already yours
                    </span>
                  )}
                </p>
                {budget && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {budget.remaining}/{budget.dailyCap} left today
                  </p>
                )}
              </div>
              {candidates.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Import top</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(candidates.length, budget?.remaining ?? 100)}
                    value={importN}
                    onChange={(e) =>
                      setImportN(Math.max(1, Math.min(candidates.length, Number(e.target.value) || 1)))
                    }
                    className="w-14 h-7 px-2 text-xs bg-transparent border border-border focus:border-foreground focus:outline-none font-mono num"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    by rating
                  </span>
                  <button
                    onClick={bulkImportTopN}
                    disabled={busy}
                    className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[10px] font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground disabled:opacity-50 active:scale-[0.97]"
                  >
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <Building2 className="size-3" />}
                    Import
                  </button>
                </div>
              )}
            </div>
            <div className="divide-y divide-border">
            {places.map((p) => (
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
                  {importedIds.has(p.googlePlaceId) && (
                    <Check className="size-3.5 text-[var(--success)] shrink-0" />
                  )}
                  {suppressedIds.has(p.googlePlaceId) && (
                    <X className="size-3.5 text-[var(--warning)] shrink-0" />
                  )}
                </div>
                {p.address && (
                  <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                )}
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground mt-1">
                  {typeof p.rating === "number" && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="size-2.5 fill-current" /> {p.rating}
                    </span>
                  )}
                  {typeof p.ratingCount === "number" && <span>({p.ratingCount})</span>}
                  {p.businessStatus && p.businessStatus !== "OPERATIONAL" && (
                    <span className="text-[var(--warning)]">{p.businessStatus.toLowerCase()}</span>
                  )}
                </div>
              </button>
            ))}
            </div>
          </div>
        )}
      </aside>
    </div>
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
          <p className="eyebrow">Business</p>
          <p className="text-lg font-medium mt-1">{p.name}</p>
        </div>
        <button
          onClick={onClose}
          className="size-8 grid place-items-center text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
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
        {p.types && p.types.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            {p.types.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground border border-border px-1.5 py-[1px]"
              >
                {t.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border space-y-2">
        <button
          onClick={onImport}
          disabled={imported}
          className={cn(
            "w-full inline-flex items-center justify-center gap-1.5 h-10 px-4 text-xs font-mono uppercase tracking-[0.12em]",
            imported
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
          )}
        >
          {imported ? <Check className="size-3.5" /> : <Building2 className="size-3.5" />}
          {imported ? "Imported to Companies" : "Import to Companies"}
        </button>
        {p.googleMapsUri && (
          <a
            href={p.googleMapsUri}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-primary"
          >
            View on Google Maps <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
