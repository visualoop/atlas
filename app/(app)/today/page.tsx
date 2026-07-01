"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  Mail, AlertTriangle, ListTodo, Calendar, ArrowRight,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatDistanceToNowStrict } from "date-fns";

export default function TodayPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const queues = useQuery(api.analytics.todayQueues, {});
  const firstName = bootstrap?.user.name?.split(/\s+/)[0] ?? "there";

  const loading = queues === undefined;

  return (
    <div className="max-w-5xl mx-auto px-8 py-16 space-y-16">
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
    </div>
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
