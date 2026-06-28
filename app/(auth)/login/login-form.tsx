"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"password" | "magic" | "signup">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === "signup") {
          const result = await authClient.signUp.email({ email, password, name });
          if (result.error) {
            toast.error(result.error.message ?? "Sign up failed");
            return;
          }
          toast.success("Account created");
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "password") {
          const result = await authClient.signIn.email({ email, password });
          if (result.error) {
            toast.error(result.error.message ?? "Sign in failed");
            return;
          }
          router.push("/today");
          router.refresh();
          return;
        }
        if (mode === "magic") {
          const result = await authClient.signIn.magicLink({
            email,
            callbackURL: "/today",
          });
          if (result.error) {
            toast.error(result.error.message ?? "Could not send magic link");
            return;
          }
          toast.success("Magic link sent (check server logs in dev — Resend not yet configured)");
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        toast.error(msg);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {mode === "signup" && (
        <div className="space-y-2">
          <Label htmlFor="name" className="eyebrow">Name</Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
      )}

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

      {mode !== "magic" && (
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
          <p className="text-xs text-muted-foreground mt-1">
            {mode === "signup" ? "Minimum 12 characters." : ""}
          </p>
        </div>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "…" : mode === "signup" ? "Create account" : mode === "magic" ? "Send magic link" : "Sign in"}
      </Button>

      <div className="flex flex-col gap-2 pt-4 border-t border-border">
        {mode !== "magic" && (
          <button
            type="button"
            onClick={() => setMode("magic")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in with a magic link →
          </button>
        )}
        {mode !== "password" && (
          <button
            type="button"
            onClick={() => setMode("password")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors"
          >
            Use a password →
          </button>
        )}
        {mode !== "signup" && (
          <button
            type="button"
            onClick={() => setMode("signup")}
            className="text-xs eyebrow text-muted-foreground hover:text-foreground transition-colors"
          >
            Create an account →
          </button>
        )}
      </div>
    </form>
  );
}
