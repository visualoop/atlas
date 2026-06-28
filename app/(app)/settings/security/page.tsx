import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";

export default async function SecurityPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Two-factor authentication</p>
        <div className="border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                {session.user.twoFactorEnabled ? "Enabled" : "Not enabled"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                Required for Org Owners. Recommended for everyone else.
              </p>
            </div>
            <button className="font-mono uppercase tracking-[0.12em] text-xs px-4 py-2 bg-primary text-primary-foreground active:scale-[0.97] transition-transform">
              {session.user.twoFactorEnabled ? "Manage" : "Enable"}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Active sessions</p>
        <div className="border border-border p-6 text-sm text-muted-foreground">
          Session listing coming in Phase 1.
        </div>
      </section>
    </div>
  );
}
