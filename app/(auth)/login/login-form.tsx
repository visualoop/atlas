"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";

type Mode = "password" | "signup" | "magic" | "magic-verify";

const REF_KEY = "atlas_ref_code";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const bootstrap = useMutation(api.referrals.bootstrapMyProfile);

  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [refCode, setRefCode] = useState<string | null>(null);

  // Capture ?ref=CODE from URL, persist to sessionStorage so it survives
  // the redirect after a magic-link click.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const paramCode = searchParams.get("ref");
    if (paramCode) {
      const normalized = paramCode.trim().toUpperCase();
      window.sessionStorage.setItem(REF_KEY, normalized);
      setRefCode(normalized);
      // If user landed with a code, default them to signup
      setMode("signup");
    } else {
      const stored = window.sessionStorage.getItem(REF_KEY);
      if (stored) setRefCode(stored);
    }
  }, [searchParams]);

  // Show "invited by X" preview
  const referrer = useQuery(
    api.referrals.resolveByCode,
    refCode ? { code: refCode } : "skip",
  );

  async function finishBootstrap() {
    const code = refCode ?? (typeof window !== "undefined"
      ? window.sessionStorage.getItem(REF_KEY)
      : null);
    try {
      const res = await bootstrap({
        referralCode: code ?? undefined,
        fullName: name.trim() || undefined,
      });
      if (res.claim.claimed) {
        toast.success("Invite code applied. Welcome to Atlas.");
      }
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(REF_KEY);
      }
    } catch (err) {
      // Non-fatal — user is already signed in
      console.error("bootstrap failed", err);
    }
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === "signup") {
          await signIn("password", { email, password, name, flow: "signUp" });
          await finishBootstrap();
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "password") {
          await signIn("password", { email, password, flow: "signIn" });
          await finishBootstrap();
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "magic") {
          await signIn("magic-link-otp", { email });
          toast.success("Check your email for the code.");
          setMode("magic-verify");
          return;
        }
        if (mode === "magic-verify") {
          await signIn("magic-link-otp", { email, code: otp });
          await finishBootstrap();
          router.push("/today");
          router.refresh();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        toast.error(msg);
      }
    });
  }

  return (
    <form onSubmit={go} className="space-y-5">
      {refCode && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
          <p className="eyebrow text-primary mb-1">Invited</p>
          <p className="text-foreground">
            You&rsquo;re using invite code{" "}
            <span className="font-mono">{refCode}</span>
            {referrer?.referrerEmail && (
              <>
                {" "}from{" "}
                <span className="font-medium">
                  {referrer.referrerName ?? referrer.referrerEmail}
                </span>
              </>
            )}
            . Once you sign up, they earn a credit.
          </p>
        </div>
      )}

      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Jane Wanjiku" />
        </div>
      )}

      {mode !== "magic-verify" && (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            placeholder="you@company.co.ke"
          />
        </div>
      )}

      {(mode === "password" || mode === "signup") && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="••••••••••••"
          />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground mt-1">Minimum 12 characters.</p>
          )}
        </div>
      )}

      {mode === "magic-verify" && (
        <div className="space-y-2">
          <Label htmlFor="otp">6-digit code</Label>
          <Input
            id="otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
            autoComplete="one-time-code"
            autoFocus
            className="font-mono tracking-[0.4em] text-2xl h-14 text-center"
          />
          <p className="text-xs text-muted-foreground">
            Sent to {email}.
          </p>
        </div>
      )}

      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending
          ? "…"
          : mode === "signup"
          ? "Create account"
          : mode === "magic"
          ? "Send code"
          : mode === "magic-verify"
          ? "Verify"
          : "Sign in"}
      </Button>

      <div className="flex flex-col gap-1 pt-4 border-t border-border">
        {mode !== "magic" && mode !== "magic-verify" && (
          <Button
            type="button"
            variant="link"
            onClick={() => setMode("magic")}
            className="h-auto justify-start px-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Sign in with a magic link →
          </Button>
        )}
        {mode !== "password" && (
          <Button
            type="button"
            variant="link"
            onClick={() => setMode("password")}
            className="h-auto justify-start px-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Use a password →
          </Button>
        )}
        {mode !== "signup" && (
          <Button
            type="button"
            variant="link"
            onClick={() => setMode("signup")}
            className="h-auto justify-start px-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Create an account →
          </Button>
        )}
      </div>
    </form>
  );
}
