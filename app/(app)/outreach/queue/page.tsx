"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import {
  Sparkles,
  ArrowRight,
  Mail,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { OutreachDrafter } from "@/components/atlas/outreach-drafter";
import { cn } from "@/lib/utils";

export default function OutreachQueuePage() {
  const suggestions = useQuery(api.outreachSuggestions.nextContactSuggestions, {
    limit: 25,
  });
  const [activeDraft, setActiveDraft] = useState<{
    companyId: Id<"companies">;
    contactId?: Id<"contacts">;
    companyName: string;
    hasEmail: boolean;
    hasPhone: boolean;
    primaryEmail?: string;
    primaryPhone?: string;
  } | null>(null);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-12 space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">Outreach queue</p>
        <h1 className="text-4xl md:text-5xl tracking-tight">
          Who to <em className="italic font-display">reach next</em>.
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every prospected company with contact info, ranked by AI fit
          score. No prior outbound message. Click Draft to open the AI
          composer for that prospect.
        </p>
      </header>

      {suggestions === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="border border-dashed border-border py-16 text-center space-y-3">
          <p className="font-display italic text-2xl text-muted-foreground">
            No prospects queued.
          </p>
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Import companies via{" "}
            <Link
              href="/prospector"
              className="text-primary hover:underline"
            >
              Prospector
            </Link>{" "}
            first, then check back here.
          </p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {suggestions.map((s) => (
            <div
              key={s.companyId}
              className="px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/companies?open=${s.companyId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {s.companyName}
                  </Link>
                  {typeof s.fitScore === "number" && (
                    <span
                      className={cn(
                        "text-[10px] font-mono px-1.5 py-0.5 border",
                        s.fitScore >= 70
                          ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
                          : s.fitScore >= 40
                            ? "border-amber-600/60 text-amber-700 dark:text-amber-500"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      Fit {s.fitScore}
                    </span>
                  )}
                  {s.industry && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {s.industry}
                    </span>
                  )}
                  {s.city && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      · {s.city}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {s.hasEmail && (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Mail className="size-3" /> {s.primaryEmail}
                    </span>
                  )}
                  {s.hasPhone && (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <MessageSquare className="size-3" /> {s.primaryPhone}
                    </span>
                  )}
                  {s.contactName && <span>· {s.contactName}</span>}
                </div>
              </div>
              <Button
                onClick={() =>
                  setActiveDraft({
                    companyId: s.companyId as Id<"companies">,
                    contactId: s.contactId as Id<"contacts"> | undefined,
                    companyName: s.companyName,
                    hasEmail: s.hasEmail,
                    hasPhone: s.hasPhone,
                    primaryEmail: s.primaryEmail,
                    primaryPhone: s.primaryPhone,
                  })
                }
                size="sm"
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="size-3.5" />
                Draft with AI
                <ArrowRight className="size-3 opacity-70" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {activeDraft && (
        <OutreachDrafter
          companyId={activeDraft.companyId}
          contactId={activeDraft.contactId}
          companyName={activeDraft.companyName}
          hasEmail={activeDraft.hasEmail}
          hasPhone={activeDraft.hasPhone}
          primaryEmail={activeDraft.primaryEmail}
          primaryPhone={activeDraft.primaryPhone}
          open={activeDraft !== null}
          onOpenChange={(o) => !o && setActiveDraft(null)}
        />
      )}
    </div>
  );
}
