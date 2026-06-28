"use client";

import { useQuery } from "convex/react";
import { Mail, AlertTriangle, ListTodo, Calendar } from "lucide-react";
import { api } from "@/convex/_generated/api";

export default function TodayPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const firstName = bootstrap?.user.name?.split(/\s+/)[0] ?? "there";

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
        <QueueCard icon={<Mail className="size-4" />} eyebrow="Replies waiting" tagline="Inbox is clear." />
        <QueueCard
          icon={<AlertTriangle className="size-4" />}
          eyebrow="Deals rotting"
          tagline="Nothing has gone quiet."
        />
        <QueueCard
          icon={<ListTodo className="size-4" />}
          eyebrow="Tasks due"
          tagline="Nothing scheduled today."
        />
        <QueueCard
          icon={<Calendar className="size-4" />}
          eyebrow="Calendar"
          tagline="No meetings today."
        />
      </section>

      <section className="space-y-4">
        <p className="eyebrow">From Atlas</p>
        <div className="border border-border p-8 space-y-3">
          <p className="font-display text-2xl italic text-muted-foreground">
            "The morning brief is empty for now."
          </p>
          <p className="text-sm text-muted-foreground max-w-prose">
            Once you've added an AI provider key in Settings → Integrations and run the daily
            digest cron, you'll see your top three actions for today here.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <p className="eyebrow">Get started</p>
        <ul className="border border-border divide-y divide-border">
          <ChecklistItem
            label="Add an AI provider key (Gemini, Groq, OpenRouter…)"
            href="/settings/integrations"
          />
          <ChecklistItem label="Connect Resend for outbound email" href="/settings/integrations" />
          <ChecklistItem label="Add your Paystack keys" href="/settings/integrations" />
          <ChecklistItem
            label="Add Google Maps API for Prospector"
            href="/settings/integrations"
          />
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
  tagline,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  tagline: string;
}) {
  return (
    <div className="bg-background p-8 min-h-[180px] flex flex-col">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="eyebrow flex items-center gap-2">
          {icon}
          {eyebrow}
        </span>
        <span className="num text-xs">0</span>
      </div>
      <div className="flex-1 flex items-end">
        <p className="text-sm text-muted-foreground">{tagline}</p>
      </div>
    </div>
  );
}

function ChecklistItem({ label, href }: { label: string; href: string }) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors text-sm"
      >
        <span className="size-4 border border-border-strong rounded-none flex items-center justify-center shrink-0" />
        <span className="flex-1">{label}</span>
        <span className="eyebrow text-muted-foreground">→</span>
      </a>
    </li>
  );
}
