"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import Link from "next/link";
import {
  Search, Loader2, MapPin, ExternalLink, Check, Building2,
  Phone, Globe, X, Info,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
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

const DEFAULT_CENTER: [number, number] = [-1.2864, 36.8172];
const DEFAULT_ZOOM = 13;

export function MapBrowseOsm() {
  const searchNearby = useAction(api.prospectorOsm.searchNearbyOsm);
  const importOne = useAction(api.prospectorActions.importOneFromMap);
  const bulkImport = useMutation(api.prospector.bulkImportMapPlaces);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [category, setCategory] = useState<string>("retail");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());
  const [importN, setImportN] = useState(10);

  const budget = useQuery(api.prospector.getImportBudget, {});
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
      // Inject Leaflet CSS lazily so we don't hydrate a global stylesheet
      if (!document.querySelector('link[data-atlas-leaflet-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-atlas-leaflet-css", "true");
        link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
        link.crossOrigin = "";
        document.head.appendChild(link);
      }
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

  // Sync markers when places / selection change
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
      const res = await searchNearby({
        latitude: center.lat,
        longitude: center.lng,
        radiusMeters: Math.round(radius),
        category: category || undefined,
      });
      if (res.error) {
        toast.error(res.error);
        setPlaces([]);
      } else {
        setPlaces(res.places);
        if (res.places.length === 0) {
          toast.info(
            "No businesses tagged here in OSM. Try zooming in, changing category, or use Google Maps to search this area (billing enabled).",
          );
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
      });
      setImportedIds((s) => new Set([...s, p.googlePlaceId]));
      toast.success(r.duplicated ? "Already in your CRM." : "Imported into Companies.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    }
  }

  const candidates = useMemo(
    () =>
      places
        .filter((p) => !importedIds.has(p.googlePlaceId) && !suppressedIds.has(p.googlePlaceId))
        .sort((a, b) => a.name.localeCompare(b.name)),
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
      setImportedIds(
        (s) => new Set([...s, ...picks.slice(0, res.imported).map((p) => p.googlePlaceId)]),
      );
      toast.success(
        `Imported ${res.imported}${res.skippedDuplicate ? ` · ${res.skippedDuplicate} already there` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-0 border border-border" style={{ minHeight: "60vh" }}>
      <div className="relative bg-muted min-h-[50vh]">
        <div ref={mapContainerRef} className="absolute inset-0" />
        <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-[400] flex-wrap">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 px-3 text-sm bg-background border border-border shadow"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={searchThisArea}
            disabled={!leafletReady || busy}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] shadow disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            Search this area
          </button>
          <button
            onClick={() => {
              if (!mapRef.current) return;
              const c = mapRef.current.getCenter();
              const q = category ? CATEGORIES.find((x) => x.value === category)?.label : "businesses";
              window.open(
                `https://www.google.com/maps/search/${encodeURIComponent(q ?? "businesses")}/@${c.lat},${c.lng},15z`,
                "_blank",
                "noopener,noreferrer",
              );
            }}
            className="inline-flex items-center gap-1 h-9 px-3 text-xs font-mono uppercase tracking-[0.12em] bg-background border border-border shadow hover:border-foreground"
            title="Open this area on Google Maps in a new tab — no API needed"
          >
            <ExternalLink className="size-3" />
            Google Maps
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-[400] text-[10px] font-mono text-muted-foreground bg-background/70 backdrop-blur px-2 py-1 flex items-center gap-1.5">
          <Info className="size-3" />
          OSM · free · limited business data
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
              Free OpenStreetMap data. Business tags are patchier than Google — expect fewer phone
              numbers + ratings. Toggle to Google mode once billing is added.
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
              {candidates.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Import top</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(candidates.length, budget?.remaining ?? 100)}
                    value={importN}
                    onChange={(e) =>
                      setImportN(
                        Math.max(1, Math.min(candidates.length, Number(e.target.value) || 1)),
                      )
                    }
                    className="w-14 h-7 px-2 text-xs bg-transparent border border-border focus:border-foreground focus:outline-none font-mono num"
                  />
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
                  </div>
                  {p.address && (
                    <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                  )}
                  {p.types && p.types.length > 0 && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      {p.types.slice(0, 2).join(" · ")}
                    </p>
                  )}
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
  const googleMapsQuery = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + (p.address ?? ""))}`;
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-4 py-3 border-b border-border flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="eyebrow">Business · OSM</p>
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
        {p.phoneRaw ? (
          <div className="flex items-start gap-2">
            <Phone className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 flex items-center justify-between gap-2 flex-wrap">
              <a href={`tel:${p.phoneRaw}`} className="text-primary hover:underline font-mono num">
                {p.phoneRaw}
              </a>
              <WhatsAppOpenChat phone={p.phoneRaw} label="Chat" size="sm" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No phone tagged in OSM. Try opening the business on Google Maps.
          </p>
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
        <div className="pt-2 space-y-1.5">
          <a
            href={googleMapsQuery}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-mono uppercase tracking-[0.12em] border border-border hover:border-foreground"
          >
            <ExternalLink className="size-3.5" />
            View on Google Maps
          </a>
          {p.googleMapsUri && (
            <a
              href={p.googleMapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-primary"
            >
              View on OpenStreetMap <ExternalLink className="size-2.5" />
            </a>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border">
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
      </div>
    </div>
  );
}
