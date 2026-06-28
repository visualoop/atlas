"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function ProfilePage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  if (!bootstrap) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const { user } = bootstrap;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Account</p>
        <div className="border border-border divide-y divide-border">
          <Row label="Name" value={user.name ?? "—"} />
          <Row label="Email" value={user.email ?? "—"} />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center px-4 py-3">
      <span className="eyebrow w-48 shrink-0">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
