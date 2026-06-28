"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function MembersPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  if (!bootstrap || !bootstrap.activeOrg) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const { user } = bootstrap;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Organization members</p>
        <div className="border border-border p-6 text-sm">
          <p>
            {user.name} <span className="text-muted-foreground">· Owner · {user.email}</span>
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Invite</p>
        <div className="border border-border p-6 text-sm text-muted-foreground">
          Invitation flow wires in fully once Resend system key is provisioned.
        </div>
      </section>
    </div>
  );
}
