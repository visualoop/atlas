"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so it shows in Sentry / Vercel logs when wired
    console.error("Atlas error boundary:", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2">
          <p className="eyebrow text-[var(--danger)]">Something broke</p>
          <h1 className="text-3xl md:text-4xl tracking-tight">
            This page hit an <em className="italic font-display">error</em>.
          </h1>
        </div>

        <div className="border border-border p-4 space-y-2 bg-[var(--surface)]/40">
          <p className="text-xs eyebrow text-muted-foreground">Error message</p>
          <p className="font-mono text-sm break-all">{error.message || "Unknown error"}</p>
          {error.digest && (
            <p className="text-[10px] font-mono text-muted-foreground">
              Digest: {error.digest}
            </p>
          )}
          {error.stack && (
            <details className="pt-2">
              <summary className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground cursor-pointer">
                Stack trace
              </summary>
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto pt-2 max-h-64">
                {error.stack}
              </pre>
            </details>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="inline-flex items-center h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
          >
            Try again
          </button>
          <Link
            href="/today"
            className="inline-flex items-center h-9 px-6 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
          >
            Back to Today
          </Link>
        </div>

        <p className="text-xs text-muted-foreground">
          If this keeps happening, open the browser console for a stack trace, or check the Convex
          logs at{" "}
          <a
            href="https://convex.atlas.blyss.co.ke"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            convex.atlas.blyss.co.ke
          </a>
          .
        </p>
      </div>
    </main>
  );
}
