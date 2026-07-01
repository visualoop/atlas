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

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

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
        const pinBg = isImported ? "#78716C" : selected?.googlePlaceId === p.googlePlaceId ? "#059669" : "#0A0A0B";
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
  }, [ready, places, selected, importedIds]);

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
        <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-10">
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
            disabled={!ready || busy}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] shadow disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            Search this area
          </button>
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
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            <div className="px-4 py-2 border-b border-border">
              <p className="eyebrow">
                {places.length} result{places.length === 1 ? "" : "s"}
              </p>
            </div>
            {places.map((p) => (
              <button
                key={p.googlePlaceId}
                onClick={() => setSelected(p)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors",
                  importedIds.has(p.googlePlaceId) && "opacity-60",
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
            <a href={`tel:${p.phoneRaw}`} className="text-primary hover:underline font-mono num">
              {p.phoneRaw}
            </a>
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
