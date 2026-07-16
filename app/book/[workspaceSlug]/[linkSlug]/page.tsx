"use client";

import { useState, use, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { Loader2, Check, Clock, Calendar as CalendarIcon, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function PublicBookingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; linkSlug: string }>;
}) {
  const resolved = use(params);
  const data = useQuery(api.calendar.getMeetingLinkBySlug, {
    workspaceSlug: resolved.workspaceSlug,
    linkSlug: resolved.linkSlug,
  });

  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const availability = useQuery(
    api.calendar.computeAvailability,
    data
      ? {
          workspaceSlug: resolved.workspaceSlug,
          linkSlug: resolved.linkSlug,
          dayMs: day,
        }
      : "skip",
  );

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ startAt: number; endAt: number } | null>(null);

  const createBooking = useMutation(api.calendar.createBooking);

  if (data === undefined) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen grid place-items-center text-center p-8">
        <div className="space-y-2">
          <p className="font-display italic text-3xl text-muted-foreground">Link not available.</p>
          <p className="text-sm text-muted-foreground">
            This booking page has been removed or deactivated.
          </p>
        </div>
      </div>
    );
  }

  const { link, workspaceName } = data;

  async function handleBook() {
    if (!selectedSlot) return;
    if (!name.trim() || !email.trim()) {
      toast.error("Enter your name and email.");
      return;
    }
    setSubmitting(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await createBooking({
        workspaceSlug: resolved.workspaceSlug,
        linkSlug: resolved.linkSlug,
        startAt: selectedSlot,
        timezone: tz,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        note: note.trim() || undefined,
      });
      setConfirmed({ startAt: selectedSlot, endAt: res.endAt });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-2xl mx-auto px-6 md:px-12 py-16 md:py-24">
          <div className="border border-[var(--success)] bg-[var(--success)]/5 p-8 space-y-3">
            <Check className="size-8 text-[var(--success)]" />
            <p className="eyebrow font-mono text-[var(--success)]">Confirmed</p>
            <h1 className="font-display italic text-4xl leading-tight">
              You're booked.
            </h1>
            <p className="text-lg">
              {new Date(confirmed.startAt).toLocaleString("en-KE", {
                weekday: "long", day: "numeric", month: "long",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              A confirmation is on its way to <span className="font-mono">{email}</span>. If you need to
              cancel or reschedule, reply to that email.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const nextSevenDays: number[] = Array.from({ length: 7 }, (_, i) => startOfDay(Date.now()) + i * 24 * 60 * 60 * 1000);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
        {/* Header */}
        <header className="space-y-3 mb-10">
          <p className="eyebrow font-mono text-muted-foreground">
            {workspaceName} · {link.durationMinutes}-minute meeting
          </p>
          <h1 className="font-display italic text-4xl md:text-5xl tracking-tight leading-[1.05]">
            {link.title}
          </h1>
          {link.description && (
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
              {link.description}
            </p>
          )}
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-8">
          {/* Slot picker */}
          <section className="space-y-4 min-w-0">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {nextSevenDays.map((d) => {
                const dObj = new Date(d);
                const active = d === day;
                return (
                  <Button
                    key={d}
                    type="button"
                    variant={active ? "default" : "outline"}
                    onClick={() => { setDay(d); setSelectedSlot(null); }}
                    className={cn(
                      "shrink-0 w-16 h-auto py-3 flex flex-col items-center text-xs",
                      active && "bg-foreground text-background hover:bg-foreground/90 border-foreground",
                    )}
                  >
                    <span className="font-mono uppercase tracking-[0.12em] text-[10px]">
                      {dObj.toLocaleDateString("en-KE", { weekday: "short" })}
                    </span>
                    <span className="text-lg font-mono num">
                      {dObj.getDate()}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-[0.12em]">
                      {dObj.toLocaleDateString("en-KE", { month: "short" })}
                    </span>
                  </Button>
                );
              })}
            </div>

            <div>
              <p className="eyebrow mb-3">
                Available slots ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </p>
              {availability === undefined ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted/50 animate-pulse" />
                  ))}
                </div>
              ) : availability === null || availability.slots.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Nothing available on this day. Try another.
                </p>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {availability.slots.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant={selectedSlot === s ? "default" : "outline"}
                      onClick={() => setSelectedSlot(s)}
                      className={cn(
                        "h-11 text-sm font-mono num",
                        selectedSlot === s && "bg-foreground text-background hover:bg-foreground/90 border-foreground",
                      )}
                    >
                      {new Date(s).toLocaleTimeString("en-KE", {
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Form */}
          <aside>
            {selectedSlot ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleBook(); }}
                className="space-y-3 border border-border p-5"
              >
                <p className="eyebrow font-mono text-muted-foreground">Your details</p>
                <div className="space-y-1 pb-2 border-b border-border">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="size-3.5" />
                    {new Date(selectedSlot).toLocaleDateString("en-KE", {
                      weekday: "long", day: "numeric", month: "short",
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="size-3.5" />
                    {new Date(selectedSlot).toLocaleTimeString("en-KE", {
                      hour: "2-digit", minute: "2-digit",
                    })}{" "}
                    · {link.durationMinutes}min
                  </p>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Name
                  </span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Email
                  </span>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Company (optional)
                  </span>
                  <Input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Note (optional)
                  </span>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="What would you like to discuss?"
                    className="resize-none"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={submitting}
                  size="lg"
                  className="w-full h-11 text-xs font-mono uppercase tracking-[0.12em]"
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                  Confirm booking
                </Button>
              </form>
            ) : (
              <div className="border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Pick a slot to see the booking form.
              </div>
            )}
          </aside>
        </div>

        <footer className="mt-16 pt-6 border-t border-border text-xs text-muted-foreground">
          <p>Powered by Atlas</p>
        </footer>
      </div>
    </main>
  );
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
