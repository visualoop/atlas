"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, Check, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accept = useMutation(api.organizations.acceptInvitation);
  const [state, setState] = useState<"idle" | "accepting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Store token so login redirect can come back
    if (typeof window !== "undefined" && params.token) {
      window.sessionStorage.setItem("atlas_invite_token", params.token);
    }
  }, [params.token]);

  async function handleAccept() {
    if (!params.token) return;
    setState("accepting");
    try {
      await accept({ token: params.token });
      setState("success");
      window.sessionStorage.removeItem("atlas_invite_token");
      setTimeout(() => router.push("/today"), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to accept.";
      setError(message);
      setState("error");
      toast.error(message);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="max-w-md w-full space-y-6">
        <div className="space-y-2">
          <p className="eyebrow">Team invitation</p>
          <h1 className="font-display italic text-5xl tracking-tight">
            Welcome<span className="text-primary">.</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            You've been invited to join a team on Atlas. Accept to get access.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Checking your session…
          </p>
        ) : !isAuthenticated ? (
          <div className="border border-border p-5 space-y-3">
            <p className="text-sm">
              Sign in first — use the same email your invitation was sent to.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em]"
            >
              Sign in <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : state === "success" ? (
          <div className="border border-primary p-5 space-y-2">
            <p className="inline-flex items-center gap-2 text-primary text-sm">
              <Check className="size-4" /> Joined. Sending you in…
            </p>
          </div>
        ) : (
          <div className="border border-border p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              Accepting will add you to the organisation and any workspaces the
              inviter selected.
            </p>
            {error && (
              <p className="text-xs text-[var(--destructive)]">{error}</p>
            )}
            <button
              onClick={handleAccept}
              disabled={state === "accepting"}
              className="inline-flex items-center gap-1.5 h-9 px-5 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] disabled:opacity-50"
            >
              {state === "accepting" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Accept invitation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
