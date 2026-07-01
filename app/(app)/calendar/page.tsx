"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import {
  Plus, Loader2, Calendar as CalendarIcon, Clock, MapPin, Video,
  ExternalLink, Copy, Check, X, ChevronLeft, ChevronRight, Key,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";

type Tab = "agenda" | "links" | "trials";

export default function CalendarPage() {
  const [tab, setTab] = useState<Tab>("agenda");

  return (
    <div className="max-w-7xl mx-auto px-8 py-8">
      <header className="mb-8">
        <p className="eyebrow">Calendar & Meetings</p>
        <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
          Time, well <em className="italic font-display">managed</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose mt-2">
          Personal calendar, public booking pages, and trial licenses — all
          in one place, all wired to your CRM.
        </p>
      </header>

      <div className="border-b border-border mb-6 flex items-center gap-1 overflow-x-auto">
        <TabButton active={tab === "agenda"} onClick={() => setTab("agenda")} icon={<CalendarIcon className="size-3.5" />}>
          Agenda
        </TabButton>
        <TabButton active={tab === "links"} onClick={() => setTab("links")} icon={<ExternalLink className="size-3.5" />}>
          Booking links
        </TabButton>
        <TabButton active={tab === "trials"} onClick={() => setTab("trials")} icon={<Key className="size-3.5" />}>
          Trials
        </TabButton>
      </div>

      {tab === "agenda" && <AgendaTab />}
      {tab === "links" && <LinksTab />}
      {tab === "trials" && <TrialsTab />}
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 h-10 text-sm border-b-2 transition-colors whitespace-nowrap",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ================================================================== */
/* Agenda                                                               */
/* ================================================================== */

function AgendaTab() {
  const [anchor, setAnchor] = useState(startOfDay(Date.now()));
  const rangeStart = anchor;
  const rangeEnd = anchor + 7 * 24 * 60 * 60 * 1000;
  const events = useQuery(api.calendar.listEvents, {
    startMs: rangeStart,
    endMs: rangeEnd,
    ownerOnly: true,
  });
  const [newOpen, setNewOpen] = useState(false);

  const byDay = useMemo(() => {
    const map = new Map<number, Doc<"calendarEvents">[]>();
    if (!events) return map;
    for (const e of events) {
      const day = startOfDay(e.startAt);
      const arr = map.get(day) ?? [];
      arr.push(e);
      map.set(day, arr);
    }
    return map;
  }, [events]);

  const days: number[] = Array.from({ length: 7 }, (_, i) => rangeStart + i * 24 * 60 * 60 * 1000);

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setAnchor(anchor - 7 * 24 * 60 * 60 * 1000)}
          className="size-9 grid place-items-center border border-border hover:bg-muted"
          title="Previous week"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={() => setAnchor(startOfDay(Date.now()))}
          className="h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] border border-border hover:bg-muted transition-colors"
        >
          This week
        </button>
        <button
          onClick={() => setAnchor(anchor + 7 * 24 * 60 * 60 * 1000)}
          className="size-9 grid place-items-center border border-border hover:bg-muted"
          title="Next week"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="ml-2 text-sm text-muted-foreground font-mono">
          {new Date(rangeStart).toLocaleDateString("en-KE", { day: "numeric", month: "short" })} —{" "}
          {new Date(rangeEnd - 1).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
        </span>
        <button
          onClick={() => setNewOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          <Plus className="size-3.5" /> New event
        </button>
      </div>

      {events === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-3">
          {days.map((day) => {
            const dayEvents = byDay.get(day) ?? [];
            return (
              <DayBlock key={day} day={day} events={dayEvents} />
            );
          })}
        </div>
      )}

      {newOpen && <NewEventDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

function DayBlock({ day, events }: { day: number; events: Doc<"calendarEvents">[] }) {
  const d = new Date(day);
  const isToday = day === startOfDay(Date.now());
  const label = d.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "short" });
  return (
    <div className={cn("border border-border", isToday && "border-primary")}>
      <div className={cn(
        "px-4 h-10 flex items-center border-b border-border",
        isToday ? "bg-primary/5 text-primary" : "bg-[var(--surface)]/40",
      )}>
        <p className="text-sm font-medium">{label}</p>
        {isToday && (
          <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.12em]">Today</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground font-mono num">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground italic">Nothing scheduled.</div>
      ) : (
        <ul className="divide-y divide-border">
          {events.sort((a, b) => a.startAt - b.startAt).map((e) => (
            <EventRow key={e._id} event={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ event: e }: { event: Doc<"calendarEvents"> }) {
  const start = new Date(e.startAt).toLocaleTimeString("en-KE", {
    hour: "2-digit", minute: "2-digit",
  });
  const end = new Date(e.endAt).toLocaleTimeString("en-KE", {
    hour: "2-digit", minute: "2-digit",
  });
  return (
    <li className="px-4 py-3 flex items-start gap-4">
      <div className="w-24 shrink-0 text-xs font-mono num text-muted-foreground">
        <div>{start}</div>
        <div className="text-[10px]">{end}</div>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{e.title}</p>
          <StatusPill status={e.status} />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          {e.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3" />
              {e.location}
            </span>
          )}
          {e.conferenceUrl && (
            <a
              href={e.conferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary transition-colors truncate"
            >
              <Video className="size-3" /> Join
            </a>
          )}
          {e.attendeeEmails && e.attendeeEmails.length > 0 && (
            <span className="truncate">with {e.attendeeEmails.join(", ")}</span>
          )}
        </div>
      </div>
    </li>
  );
}

function NewEventDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState(defaultDatetimeLocal(Date.now() + 60 * 60 * 1000));
  const [endAt, setEndAt] = useState(defaultDatetimeLocal(Date.now() + 2 * 60 * 60 * 1000));
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.calendar.createEvent);

  async function submit() {
    if (!title.trim()) {
      toast.error("Give it a title.");
      return;
    }
    const startMs = new Date(startAt).getTime();
    const endMs = new Date(endAt).getTime();
    if (endMs <= startMs) {
      toast.error("End must be after start.");
      return;
    }
    setSaving(true);
    try {
      await create({
        kind: "meeting",
        title: title.trim(),
        description: description.trim() || undefined,
        startAt: startMs,
        endAt: endMs,
        location: location.trim() || undefined,
      });
      toast.success("Event created.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New event" onClose={onClose} saving={saving} onSubmit={submit} submitLabel="Create">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Title</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting with Java House"
          className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Start</span>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">End</span>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)}
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Location</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder="Zoom URL or physical location"
          className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none" />
      </label>
    </ModalShell>
  );
}

/* ================================================================== */
/* Meeting links                                                        */
/* ================================================================== */

function LinksTab() {
  const links = useQuery(api.calendar.listMeetingLinks, {});
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const [newOpen, setNewOpen] = useState(false);
  const wsSlug = bootstrap?.activeWorkspace?.slug ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Booking links</p>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          <Plus className="size-3.5" /> New link
        </button>
      </div>
      {links === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : links.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-center space-y-2">
          <p className="font-display italic text-2xl text-muted-foreground">No booking links yet.</p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Create a public link people use to book time with you. Atlas
            handles availability, buffers, timezones, and reminders.
          </p>
        </div>
      ) : (
        <ul className="border border-border divide-y divide-border">
          {links.map((l) => (
            <MeetingLinkRow key={l._id} link={l} wsSlug={wsSlug} />
          ))}
        </ul>
      )}
      {newOpen && <NewMeetingLinkDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function MeetingLinkRow({
  link: l, wsSlug,
}: { link: Doc<"meetingLinks">; wsSlug: string }) {
  const [copied, setCopied] = useState(false);
  const publicUrl = wsSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/book/${wsSlug}/${l.slug}`
    : "";
  return (
    <li className="px-4 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium">{l.title}</p>
        {l.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{l.description}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
          <span>{l.durationMinutes}min</span>
          <span>{l.timezone}</span>
          <span>Buffer +{l.bufferMinutesAfter}min</span>
        </div>
      </div>
      {wsSlug && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              toast.success("Copied.");
            }}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy link"
          >
            {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Open"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </li>
  );
}

function NewMeetingLinkDialog({ onClose }: { onClose: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(30);
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.calendar.createMeetingLink);

  // Simple weekday availability: Mon-Fri 9-17
  const defaultAvailability = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMin: 9 * 60,
    endMin: 17 * 60,
  }));

  async function submit() {
    if (!slug.trim() || !title.trim()) {
      toast.error("Slug + title required.");
      return;
    }
    setSaving(true);
    try {
      await create({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        durationMinutes: duration,
        availability: defaultAvailability,
        conferenceUrl: conferenceUrl.trim() || undefined,
      });
      toast.success("Booking link created.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New booking link" onClose={onClose} saving={saving} onSubmit={submit} submitLabel="Create">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Title</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Omnix demo — 30min"
          className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Slug</span>
        <input value={slug} onChange={(e) => setSlug(e.target.value)}
          placeholder="omnix-demo"
          className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono" />
        <p className="text-[11px] text-muted-foreground mt-1">
          URL: /book/&lt;workspace&gt;/<code className="font-mono">{slug || "your-slug"}</code>
        </p>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Duration</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full h-9 px-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none">
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Conference URL</span>
          <input value={conferenceUrl} onChange={(e) => setConferenceUrl(e.target.value)}
            placeholder="https://meet.google.com/..."
            className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          placeholder="What'll we cover?"
          className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none" />
      </label>
      <p className="text-xs text-muted-foreground">
        Availability defaults to Mon-Fri 09:00-17:00 (Africa/Nairobi). Adjust from
        the Convex dashboard for now — an in-app editor comes in the follow-up.
      </p>
    </ModalShell>
  );
}

/* ================================================================== */
/* Trials                                                               */
/* ================================================================== */

function TrialsTab() {
  const trials = useQuery(api.calendar.listTrialLicenses, {});
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Trial licenses</p>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
        >
          <Plus className="size-3.5" /> New trial
        </button>
      </div>
      {trials === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : trials.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-center space-y-2">
          <p className="font-display italic text-2xl text-muted-foreground">
            No trial licenses yet.
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Issue trial keys for Omnix or other Blyss products — track
            activation, renewals, and conversion.
          </p>
        </div>
      ) : (
        <ul className="border border-border divide-y divide-border">
          {trials.map((t) => <TrialRow key={t._id} trial={t} />)}
        </ul>
      )}
      {newOpen && <NewTrialDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function TrialRow({ trial: t }: { trial: Doc<"trialLicenses"> }) {
  const endMs = t.trialEndAt;
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((endMs - now) / (24 * 60 * 60 * 1000)));
  const [copied, setCopied] = useState(false);
  return (
    <li className="px-4 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
            {t.productSlug}
          </span>
          <StatusPill status={t.status} />
        </div>
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm bg-muted px-2 py-1">{t.licenseKey}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(t.licenseKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              toast.success("Copied.");
            }}
            className="size-6 grid place-items-center text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3 text-[var(--success)]" /> : <Copy className="size-3" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground font-mono num">
          {t.status === "active"
            ? `${daysLeft} days left · ends ${new Date(endMs).toLocaleDateString("en-KE")}`
            : `Expired ${new Date(endMs).toLocaleDateString("en-KE")}`}
        </p>
      </div>
    </li>
  );
}

function NewTrialDialog({ onClose }: { onClose: () => void }) {
  const [productSlug, setProductSlug] = useState("omnix");
  const [days, setDays] = useState(14);
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.calendar.createTrialLicense);

  async function submit() {
    setSaving(true);
    try {
      await create({ productSlug, durationDays: days });
      toast.success("Trial issued.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New trial license" onClose={onClose} saving={saving} onSubmit={submit} submitLabel="Issue">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Product</span>
        <select value={productSlug} onChange={(e) => setProductSlug(e.target.value)}
          className="w-full h-9 px-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none">
          <option value="omnix">Omnix</option>
          <option value="blyss_studio">Blyss Studio</option>
          <option value="marketplace">Marketplace</option>
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">Duration</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="w-full h-9 px-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none">
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>
    </ModalShell>
  );
}

/* ================================================================== */
/* Shared                                                               */
/* ================================================================== */

function ModalShell({
  title, children, onClose, saving, onSubmit, submitLabel,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  saving: boolean;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">{title}</p>
        </header>
        <div className="px-6 py-4 space-y-3">{children}</div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {submitLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: "border-[var(--info)] text-[var(--info)]",
  in_progress: "border-[var(--warning)] text-[var(--warning)]",
  completed: "border-[var(--success)] text-[var(--success)]",
  cancelled: "border-border text-muted-foreground opacity-60",
  no_show: "border-[var(--danger)] text-[var(--danger)]",
  active: "border-[var(--success)] text-[var(--success)]",
  expired: "border-border text-muted-foreground",
  converted: "border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5",
      STATUS_STYLES[status] ?? STATUS_STYLES.scheduled,
    )}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function defaultDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
