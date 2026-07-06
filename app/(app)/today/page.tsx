"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { useState, useEffect } from "react";
import {
  Mail, AlertTriangle, ListTodo, Calendar, ArrowRight, Sparkles, RefreshCw, Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";

export default function TodayPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const queues = useQuery(api.analytics.todayQueues, {});
  const briefing = useQuery(api.dailyBriefingsHelpers.latestForWorkspace);
  const refresh = useAction(api.dailyBriefingsHelpers.refreshMine);
  const [refreshing, setRefreshing] = useState(false);
  const firstName = bootstrap?.user.name?.split(/\s+/)[0] ?? "there";

  const loading = queues === undefined;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh({});
      toast.success("Briefing refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-16 space-y-16">
      <header className="space-y-2">
        <p className="eyebrow">
          Today ·{" "}
          {new Date().toLocaleDateString("en-KE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="text-4xl md:text-5xl leading-tight tracking-tight">
          {greetingForNow()}, <em className="italic font-display">{firstName}</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Your queue for today. Replies waiting, deals rotting, tasks due, calendar — with
          AI-suggested next moves.
        </p>
      </header>

      {/* AI briefing paragraph */}
      <section className="border-l-2 border-primary/60 pl-4 py-1 relative group">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles className="size-3 text-primary" />
            AI briefing
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-50 inline-flex items-center gap-1"
          >
            {refreshing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Refresh
          </button>
        </div>
        {briefing === undefined ? (
          <p className="text-sm text-muted-foreground italic">Loading…</p>
        ) : briefing === null ? (
          <p className="text-sm text-muted-foreground italic">
            No briefing yet. Click Refresh to generate one.
          </p>
        ) : (
          <>
            <p className="text-base leading-relaxed">{briefing.briefing}</p>
            <p className="text-[11px] font-mono text-muted-foreground/60 mt-2">
              {formatDistanceToNowStrict(briefing.generatedAt, { addSuffix: true })}
              {briefing.modelUsed ? ` · ${briefing.modelUsed}` : ""}
            </p>
          </>
        )}
      </section>

      {/* AI action bar — 3 concrete moves for right now */}
      <TodayActionBar />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
        <QueueCard
          icon={<Mail className="size-4" />}
          eyebrow="Replies waiting"
          count={queues?.repliesWaiting ?? 0}
          loading={loading}
          tagline={
            queues?.firstReply?.subject
              ? `First: ${queues.firstReply.subject.slice(0, 60)}`
              : "Inbox is clear."
          }
          href={queues?.firstReply ? "/inbox" : undefined}
        />
        <QueueCard
          icon={<AlertTriangle className="size-4" />}
          eyebrow="Deals rotting"
          count={queues?.dealsRotting ?? 0}
          loading={loading}
          tagline={
            queues?.firstRottingDeal
              ? `Oldest: ${queues.firstRottingDeal.name}`
              : "Nothing has gone quiet."
          }
          href={queues?.firstRottingDeal ? "/pipelines" : undefined}
        />
        <QueueCard
          icon={<ListTodo className="size-4" />}
          eyebrow="Tasks due"
          count={queues?.tasksDueToday ?? 0}
          loading={loading}
          tagline={
            queues?.firstTask
              ? `Top: ${queues.firstTask.title}`
              : "Nothing scheduled today."
          }
          href={queues?.firstTask ? "/today" : undefined}
        />
        <QueueCard
          icon={<Calendar className="size-4" />}
          eyebrow="Calendar"
          count={queues?.meetingsToday ?? 0}
          loading={loading}
          tagline={
            queues?.firstMeeting
              ? `${queues.firstMeeting.title} · ${formatDistanceToNowStrict(
                  new Date(queues.firstMeeting.startAt),
                  { addSuffix: true },
                )}`
              : "No meetings today."
          }
          href={queues?.firstMeeting ? "/calendar" : undefined}
        />
      </section>

      <section className="space-y-4">
        <p className="eyebrow">Get started</p>
        <ul className="border border-border divide-y divide-border">
          <ChecklistItem
            label="Add an AI provider key (Gemini, Groq, OpenRouter…)"
            href="/settings/integrations"
          />
          <ChecklistItem label="Set your workspace brand for the AI" href="/settings/workspace" />
          <ChecklistItem label="Connect Resend for outbound email" href="/settings/integrations" />
          <ChecklistItem
            label="Add Google Maps API for Prospector (or use OSM free)"
            href="/settings/integrations"
          />
          <ChecklistItem label="Add your Paystack keys" href="/settings/integrations" />
          <ChecklistItem label="Invite a team member" href="/settings/members" />
        </ul>
      </section>

      <NextContactsSection />
    </div>
  );
}

function NextContactsSection() {
  const suggestions = useQuery(api.outreachSuggestions.nextContactSuggestions, {
    limit: 5,
  });

  if (suggestions === undefined) return null;
  if (suggestions.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="eyebrow">Who to contact next</p>
          <h2 className="font-display italic text-2xl mt-1">
            Top prospects with contact info.
          </h2>
        </div>
        <Link
          href="/prospector"
          className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Prospector
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <ul className="border border-border divide-y divide-border">
        {suggestions.map((s) => (
          <li key={s.companyId} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <Link
                  href={`/companies?open=${s.companyId}`}
                  className="text-sm font-medium truncate hover:underline"
                >
                  {s.companyName}
                </Link>
                {typeof s.fitScore === "number" && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 border ${
                      s.fitScore >= 70
                        ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
                        : s.fitScore >= 40
                          ? "border-amber-600/60 text-amber-700 dark:text-amber-500"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {s.fitScore}
                  </span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  {[s.industry, s.city].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
                {s.hasEmail && <span>📧 {s.primaryEmail}</span>}
                {s.hasPhone && <span>📞 {s.primaryPhone}</span>}
                {s.contactName && <span>· {s.contactName}</span>}
              </div>
            </div>
            <Link
              href={`/companies?open=${s.companyId}&draft=1`}
              className="text-xs font-mono uppercase tracking-[0.12em] h-8 px-3 bg-primary text-primary-foreground inline-flex items-center gap-1 hover:opacity-90"
            >
              Draft
              <ArrowRight className="size-3" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 5) return "Up early";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}

function QueueCard({
  icon,
  eyebrow,
  count,
  loading,
  tagline,
  href,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  count: number;
  loading: boolean;
  tagline: string;
  href?: string;
}) {
  const inner = (
    <div className="bg-background p-8 min-h-[180px] flex flex-col group transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="eyebrow flex items-center gap-2">
          {icon}
          {eyebrow}
        </span>
        {loading ? (
          <span className="inline-block h-3 w-8 bg-muted rounded-none animate-pulse" />
        ) : (
          <span
            className={`num text-xs ${
              count > 0 ? "text-foreground font-semibold" : "text-muted-foreground"
            }`}
          >
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 flex items-end">
        <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
          {tagline}
        </p>
      </div>
      {href && !loading && count > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs font-mono uppercase tracking-[0.12em] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Open <ArrowRight className="size-3" />
        </p>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ChecklistItem({ label, href }: { label: string; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40 transition-colors"
      >
        <span className="flex-1">{label}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
      </Link>
    </li>
  );
}


/* ============================================================ */
/* TodayActionBar — three moves for right now                    */
/* ============================================================ */

function TodayActionBar() {
  const router = useRouter();
  const runAgent = useAction(api.pageAgents.rankTodayActions);
  const [actions, setActions] = useState<
    Array<{ kind: string; title: string; actionLink: string }> | null
  >(null);
  const [loading, setLoading] = useState(false);

  async function runOnce() {
    setLoading(true);
    try {
      const r = await runAgent({});
      setActions(r.actions ?? []);
    } catch {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (actions === null && !loading) {
      void runOnce();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (actions === null || loading) {
    return (
      <section className="rounded-md border bg-muted/30 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Working out today's priorities…
      </section>
    );
  }
  if (actions.length === 0) return null;

  return (
    <section className="border-l-2 border-primary/60 pl-4 py-1 space-y-2">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          Do these next
        </p>
        <button
          onClick={runOnce}
          className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RefreshCw className="size-3" />
          Refresh
        </button>
      </div>
      <ol className="space-y-1.5">
        {actions.map((a, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-sm border-b border-border/50 last:border-b-0 pb-2 last:pb-0"
          >
            <span className="w-5 text-right text-xs font-mono text-muted-foreground shrink-0 pt-0.5">
              {i + 1}.
            </span>
            <span className="flex-1 leading-snug">{a.title}</span>
            <button
              onClick={() => router.push(a.actionLink)}
              className="text-[11px] font-mono uppercase tracking-[0.12em] text-primary hover:underline shrink-0 inline-flex items-center gap-1"
            >
              Open
              <ArrowRight className="size-3" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
