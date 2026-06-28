import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Account</p>
        <div className="border border-border divide-y divide-border">
          <Row label="Name" value={session.user.name} />
          <Row label="Email" value={session.user.email} />
          <Row label="Email verified" value={session.user.emailVerified ? "Yes" : "No"} />
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
