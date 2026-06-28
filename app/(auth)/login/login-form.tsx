"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Mode = "password" | "signup" | "magic" | "magic-verify";

export function LoginForm() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === "signup") {
          await signIn("password", { email, password, name, flow: "signUp" });
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "password") {
          await signIn("password", { email, password, flow: "signIn" });
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "magic") {
          await signIn("magic-link-otp", { email });
          toast.success("Check your email for the code (or the dev server logs for now).");
          setMode("magic-verify");
          return;
        }
        if (mode === "magic-verify") {
          await signIn("magic-link-otp", { email, code: otp });
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
    <form onSubmit={go} className="space-y-6">
      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="name" className="eyebrow">Name</Label>
          <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </div>
      )}

      {mode !== "magic-verify" && (
        <div className="space-y-2">
          <Label htmlFor="email" className="eyebrow">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>
      )}

      {(mode === "password" || mode === "signup") && (
        <div className="space-y-2">
          <Label htmlFor="password" className="eyebrow">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground mt-1">Minimum 12 characters.</p>
          )}
        </div>
      )}

      {mode === "magic-verify" && (
        <div className="space-y-2">
          <Label htmlFor="otp" className="eyebrow">6-digit code</Label>
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
            className="font-mono tracking-[0.4em] text-2xl"
          />
          <p className="text-xs text-muted-foreground">
            Sent to {email}. In dev, check the Convex server logs.
          </p>
        </div>
      )}

      <Button type="submit" disabled={pending} className="w-full">
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

      <div className="flex flex-col gap-2 pt-4 border-t border-border">
        {mode !== "magic" && mode !== "magic-verify" && (
          <button
            type="button"
            onClick={() => setMode("magic")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Sign in with a magic link →
          </button>
        )}
        {mode !== "password" && (
          <button
            type="button"
            onClick={() => setMode("password")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Use a password →
          </button>
        )}
        {mode !== "signup" && (
          <button
            type="button"
            onClick={() => setMode("signup")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Create an account →
          </button>
        )}
      </div>
    </form>
  );
}
