"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Loader2, X, ShieldCheck, KeyRound, Copy, Check, Trash2,
  Smartphone, LogOut, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

export default function SecurityPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const sessions = useQuery(api.security.listMySessions, {});
  const twofa = useQuery(api.security.myTwoFactor, {});
  const auditLog = useQuery(api.security.myRecentAudit, { limit: 20 });
  const revokeSession = useMutation(api.security.revokeSession);
  const revokeAllOthers = useMutation(api.security.revokeAllOtherSessions);
  const [showEnroll, setShowEnroll] = useState(false);

  async function handleRevokeOthers() {
    if (!confirm("Sign out every other session? You'll stay signed in here.")) return;
    try {
      const r = await revokeAllOthers({});
      toast.success(`Revoked ${r.count} other session${r.count === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <>
      <div className="space-y-10">
        {/* Sessions */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Active sessions</p>
            {sessions && sessions.length > 1 && (
              <button
                onClick={handleRevokeOthers}
                className="text-xs font-mono uppercase tracking-[0.12em] px-3 h-8 border border-[var(--border-strong)] hover:border-[var(--destructive)] hover:text-[var(--destructive)] transition-colors"
              >
                <LogOut className="size-3 inline mr-1" /> Sign out others
              </button>
            )}
          </div>
          {sessions === undefined ? (
            <SessionsSkeleton />
          ) : sessions.length === 0 ? (
            <div className="border border-border p-6 text-sm text-muted-foreground">
              No active sessions found.
            </div>
          ) : (
            <div className="border border-border divide-y divide-border">
              {sessions.map((s) => (
                <SessionRow
                  key={s._id}
                  session={s}
                  onRevoke={async () => {
                    if (!confirm("Revoke this session?")) return;
                    try {
                      await revokeSession({ sessionId: s._id });
                      toast.success(s.current ? "Signed out." : "Revoked.");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed.");
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Two-factor auth */}
        <section className="space-y-3">
          <p className="eyebrow">Two-factor authentication</p>
          <div className="border border-border p-5 space-y-3">
            {twofa === undefined ? (
              <div className="h-4 w-32 bg-muted animate-pulse rounded-none" />
            ) : twofa.enabled ? (
              <>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-[var(--success)]" />
                  <p className="text-sm">
                    2FA is <span className="text-[var(--success)]">enabled</span> — TOTP
                    from an authenticator app.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enrolled {formatDistanceToNowStrict(new Date(twofa.enabledAt ?? 0), { addSuffix: true })}
                </p>
                <DisableTwoFactorForm />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-[var(--warning)]" />
                  <p className="text-sm">
                    2FA is <span className="text-[var(--warning)]">disabled</span>. Highly
                    recommended for founder accounts.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use any authenticator (Google Authenticator, 1Password, Bitwarden, Authy).
                </p>
                <button
                  onClick={() => setShowEnroll(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em]"
                >
                  <KeyRound className="size-3.5" /> Enable 2FA
                </button>
              </>
            )}
          </div>
        </section>

        {/* Audit log */}
        <section className="space-y-3">
          <p className="eyebrow">Recent activity</p>
          {auditLog === undefined ? (
            <div className="border border-border p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 h-6">
                  <div className="w-24 h-3 bg-muted rounded-none animate-pulse" />
                  <div className="flex-1 h-3 bg-muted rounded-none animate-pulse" />
                </div>
              ))}
            </div>
          ) : auditLog.length === 0 ? (
            <div className="border border-border p-6 text-sm text-muted-foreground italic">
              No activity yet.
            </div>
          ) : (
            <div className="border border-border divide-y divide-border font-mono text-xs">
              {auditLog.map((a) => (
                <div key={a._id} className="px-3 py-2 grid grid-cols-[130px_120px_1fr] gap-3 items-baseline">
                  <span className="text-muted-foreground num">
                    {new Date(a._creationTime).toLocaleString()}
                  </span>
                  <span className="eyebrow text-[10px]">{a.action}</span>
                  <span className="text-muted-foreground truncate">
                    {a.resourceType}
                    {a.resourceId ? `:${(a.resourceId as string).slice(-6)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showEnroll && <EnrollTwoFactorDialog onClose={() => setShowEnroll(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function SessionsSkeleton() {
  return (
    <div className="border border-border divide-y divide-border">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="px-4 py-4 flex items-start gap-4">
          <div className="size-9 bg-muted rounded-none animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-muted rounded-none animate-pulse w-1/3" />
            <div className="h-3 bg-muted rounded-none animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  session: s,
  onRevoke,
}: {
  session: {
    _id: Id<"authSessions">;
    userAgent?: string;
    ipAddress?: string;
    lastActiveAt: number;
    _creationTime: number;
    current: boolean;
  };
  onRevoke: () => void;
}) {
  const label = describeUserAgent(s.userAgent);
  return (
    <div className="px-4 py-4 flex items-start gap-4">
      <div className="size-9 border border-border grid place-items-center text-muted-foreground shrink-0">
        <Smartphone className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium">{label}</p>
          {s.current && (
            <span className="eyebrow text-[10px] text-[var(--success)]">This device</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {s.ipAddress ? `${s.ipAddress} · ` : ""}
          last active {formatDistanceToNowStrict(new Date(s.lastActiveAt), { addSuffix: true })}
        </p>
        <p className="text-[11px] text-muted-foreground font-mono">
          Signed in {formatDistanceToNowStrict(new Date(s._creationTime), { addSuffix: true })}
        </p>
      </div>
      <button
        onClick={onRevoke}
        className="text-xs font-mono uppercase tracking-[0.12em] h-8 px-3 border border-border hover:border-[var(--destructive)] hover:text-[var(--destructive)] transition-colors"
      >
        {s.current ? "Sign out" : "Revoke"}
      </button>
    </div>
  );
}

function describeUserAgent(ua?: string): string {
  if (!ua) return "Unknown device";
  if (/iphone|ios/i.test(ua)) return "iOS · iPhone";
  if (/android/i.test(ua)) return "Android device";
  if (/mac os x/i.test(ua)) return "macOS · desktop";
  if (/windows/i.test(ua)) return "Windows · desktop";
  if (/linux/i.test(ua)) return "Linux · desktop";
  return ua.slice(0, 40);
}

/* ------------------------------------------------------------------ */

function EnrollTwoFactorDialog({ onClose }: { onClose: () => void }) {
  const beginEnroll = useAction(api.securityActions.beginTotpEnrollment);
  const confirmEnroll = useMutation(api.security.confirmTotpEnrollment);
  const [step, setStep] = useState<"loading" | "verify">("loading");
  const [payload, setPayload] = useState<{
    secret: string;
    qrDataUrl: string;
    otpauth: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await beginEnroll({});
        setPayload(r);
        setStep("verify");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed.");
        onClose();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    if (code.length !== 6 || !payload) return;
    setBusy(true);
    try {
      await confirmEnroll({ secret: payload.secret, code });
      toast.success("2FA enabled.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-background/60 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-sm shadow-2xl">
        <header className="px-6 py-4 border-b border-border">
          <p className="eyebrow font-mono">Two-factor</p>
          <h2 className="font-display italic text-2xl mt-1">Enable 2FA.</h2>
        </header>
        {step === "loading" || !payload ? (
          <div className="p-8 grid place-items-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="px-6 py-4 space-y-4">
            <div>
              <p className="eyebrow mb-2">1. Scan with your authenticator</p>
              <div className="flex justify-center py-2">
                <img
                  src={payload.qrDataUrl}
                  alt="TOTP QR code"
                  className="size-40 bg-white p-2"
                />
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] font-mono bg-muted p-2 truncate">
                  {payload.secret}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(payload.secret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="size-8 grid place-items-center text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                </button>
              </div>
            </div>
            <div>
              <p className="eyebrow mb-2">2. Enter the 6-digit code</p>
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                placeholder="000000"
                className="w-full h-12 px-3 text-center text-2xl tracking-widest font-mono bg-transparent border border-border focus:border-foreground focus:outline-none"
              />
            </div>
          </div>
        )}
        <footer className="px-6 py-3 border-t border-border flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="ml-auto text-xs font-mono uppercase tracking-[0.12em] h-8 px-4 text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={verify}
            disabled={busy || code.length !== 6}
            className="inline-flex items-center gap-1.5 h-8 px-5 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}

function DisableTwoFactorForm() {
  const disable = useMutation(api.security.disableTwoFactor);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (code.length !== 6) {
      toast.error("Enter the current 6-digit code.");
      return;
    }
    if (!confirm("Turn off 2FA?")) return;
    setBusy(true);
    try {
      await disable({ code });
      toast.success("2FA disabled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 pt-2">
      <input
        inputMode="numeric"
        placeholder="Current code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="h-8 px-3 text-sm font-mono w-32 bg-transparent border border-border focus:border-foreground focus:outline-none"
      />
      <button
        onClick={go}
        disabled={busy}
        className="text-xs font-mono uppercase tracking-[0.12em] h-8 px-3 border border-border hover:border-[var(--destructive)] hover:text-[var(--destructive)] disabled:opacity-50"
      >
        Disable
      </button>
    </div>
  );
}

// Local re-import to appease the eslint plugin above
import { useEffect } from "react";
