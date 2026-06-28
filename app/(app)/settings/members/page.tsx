import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";

export default async function MembersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Organization members</p>
        <div className="border border-border p-6 text-sm">
          <p>{session.user.name} <span className="text-muted-foreground">· Owner · {session.user.email}</span></p>
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Invite</p>
        <div className="border border-border p-6 text-sm text-muted-foreground">
          Invitation flow wires in fully during Phase 0 follow-up once Resend system key is set.
        </div>
      </section>
    </div>
  );
}
