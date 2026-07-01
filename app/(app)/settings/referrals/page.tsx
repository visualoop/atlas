"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { Copy, Check, Share2, Users, DollarSign } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNowStrict } from "date-fns";

export default function ReferralsSettingsPage() {
  const info = useQuery(api.referrals.myReferralInfo, {});
  const claims = useQuery(api.referrals.listMyClaims, {});
  const [origin, setOrigin] = useState<string>("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  if (info === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const code = info.referralCode ?? "";
  const shareUrl = code ? `${origin}/login?ref=${code}` : "";
  const totalEarned = formatCurrency(info.totalEarnedCents, info.currency);
  const currentCredits = formatCurrency(info.referralCreditsCents, info.currency);

  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm text-muted-foreground max-w-prose">
          Share your invite code. Every new Atlas signup that uses it credits
          your account toward your Atlas subscription. Credits are applied
          automatically at billing time.
        </p>
      </div>

      {/* Code + Share URL */}
      <section className="space-y-3">
        <p className="eyebrow">Your invite code</p>
        <div className="border border-border p-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-muted-foreground mb-2">Code</p>
              <div className="flex items-center gap-3">
                <code className="font-mono text-3xl tracking-[0.2em] bg-muted px-4 py-2">
                  {code || "—"}
                </code>
                {code && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      setCopied("code");
                      setTimeout(() => setCopied(null), 1500);
                      toast.success("Code copied.");
                    }}
                    className="size-9 grid place-items-center border border-border hover:bg-muted transition-colors"
                    title="Copy code"
                  >
                    {copied === "code" ? <Check className="size-4 text-[var(--success)]" /> : <Copy className="size-4" />}
                  </button>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="eyebrow text-muted-foreground mb-2">Total earned</p>
              <p className="text-3xl font-mono num tracking-tight">{totalEarned}</p>
              {info.referralCreditsCents !== info.totalEarnedCents && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current balance {currentCredits}
                </p>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="eyebrow text-muted-foreground mb-2">Share link</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs bg-muted px-3 py-2 flex-1 truncate">
                {shareUrl}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied("link");
                  setTimeout(() => setCopied(null), 1500);
                  toast.success("Link copied.");
                }}
                className="size-9 grid place-items-center border border-border hover:bg-muted transition-colors"
                title="Copy link"
              >
                {copied === "link" ? <Check className="size-4 text-[var(--success)]" /> : <Copy className="size-4" />}
              </button>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: "Join me on Atlas",
                      text: `Try Atlas — the operating system for a founder. Use my invite code ${code}.`,
                      url: shareUrl,
                    }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(shareUrl);
                    toast.success("Link copied.");
                  }
                }}
                className="size-9 grid place-items-center border border-border hover:bg-muted transition-colors"
                title="Share"
              >
                <Share2 className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats + claims list */}
      <section className="space-y-3">
        <p className="eyebrow">Referrals</p>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Signed up" value={String(info.claimsCount)} icon={<Users className="size-3.5" />} />
          <StatCard label="Credited" value={String(info.creditedCount)} icon={<Check className="size-3.5" />} />
          <StatCard label="Balance" value={currentCredits} icon={<DollarSign className="size-3.5" />} mono />
        </div>

        {claims === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : claims.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground italic">
            No one has used your code yet. Share the link above.
          </div>
        ) : (
          <ul className="border border-border divide-y divide-border">
            {claims.map((c) => (
              <li key={c._id} className="px-4 py-3 flex items-baseline gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {c.referredUserName || c.referredUserEmail || "New signup"}
                  </p>
                  {c.referredUserEmail && (
                    <p className="text-xs text-muted-foreground truncate">
                      {c.referredUserEmail}
                    </p>
                  )}
                </div>
                <StatusPill status={c.status} />
                <span className="text-sm font-mono num shrink-0 w-24 text-right">
                  {formatCurrency(c.creditedAmountCents, c.currency)}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-20 text-right">
                  {formatDistanceToNowStrict(new Date(c.claimedAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label, value, icon, mono,
}: { label: string; value: string; icon: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border border-border p-4 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={cn("text-2xl tracking-tight", mono && "font-mono num")}>{value}</p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  credited: "border-[var(--success)] text-[var(--success)]",
  pending_verification: "border-[var(--warning)] text-[var(--warning)]",
  reversed: "border-[var(--danger)] text-[var(--danger)]",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      "inline-flex items-center font-mono uppercase tracking-[0.12em] text-[9px] border px-2 py-0.5 shrink-0",
      STATUS_STYLES[status] ?? "border-border text-muted-foreground",
    )}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatCurrency(cents: string, currency: string): string {
  const value = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}
