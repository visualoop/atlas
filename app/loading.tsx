"use client";

import { useEffect, useState } from "react";

/**
 * Root loading — shown while Next.js is streaming server components
 * for pre-auth routes. The animated progress bar tells the user the
 * app is alive; the timer shows how long they've been waiting
 * (usually <1s but useful signal if the backend is slow).
 */
export default function RootLoading() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center space-y-5 max-w-sm">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Atlas · warming up
        </p>
        <h1 className="font-display italic text-6xl tracking-tight text-foreground/70">
          Loading<span className="text-primary">.</span>
        </h1>
        <div className="relative w-56 h-1 bg-border mx-auto overflow-hidden">
          <div
            className="absolute inset-y-0 w-1/3 bg-primary atlas-progress"
            aria-hidden="true"
          />
        </div>
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground/60 num">
          {elapsed.toFixed(1)}s
        </p>
      </div>
    </div>
  );
}
