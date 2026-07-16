"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, X, Mail, Copy, Check } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type OrgRole = "owner" | "admin" | "member";

export default function MembersPage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const orgId = bootstrap?.activeOrg?._id;
  const invitations = useQuery(
    api.organizations.listInvitations,
    orgId ? { organizationId: orgId } : "skip",
  );
  const createInvitation = useMutation(api.organizations.createInvitation);
  const revokeInvitation = useMutation(api.organizations.revokeInvitation);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!bootstrap || !bootstrap.activeOrg) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const { user, activeOrg } = bootstrap;

  async function invite() {
    if (!orgId) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Email looks invalid.");
      return;
    }
    setBusy(true);
    try {
      const res = await createInvitation({
        organizationId: orgId,
        email: email.trim().toLowerCase(),
        role,
      });
      toast.success(`Invited ${email.trim().toLowerCase()}. Email sent.`);
      setLastCreatedUrl(res.acceptUrl);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: Id<"invitations">) {
    if (!confirm("Revoke this invitation?")) return;
    try {
      await revokeInvitation({ invitationId: id });
      toast.success("Revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  function copyUrl() {
    if (!lastCreatedUrl) return;
    navigator.clipboard.writeText(lastCreatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const pending = invitations?.filter((i) => i.status === "pending") ?? [];
  const accepted = invitations?.filter((i) => i.status === "accepted") ?? [];

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <p className="eyebrow">Organization: {activeOrg.name}</p>
        <div className="border border-border">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="size-9 border border-border grid place-items-center text-xs font-mono">
              {(user.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <span className="eyebrow text-primary">Owner</span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Invite teammate</p>
        <div className="border border-border p-4 md:p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.co.ke"
              className="h-9"
              onKeyDown={(e) => e.key === "Enter" && invite()}
            />
            <Select value={role} onValueChange={(v) => v && setRole(v as OrgRole)}>
              <SelectTrigger size="sm" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member — full access</SelectItem>
                <SelectItem value="admin">Admin — invite + billing</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={invite}
              disabled={busy || email.trim().length === 0}
              className="h-9 text-xs font-mono uppercase tracking-[0.12em]"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            An invitation email will be sent from{" "}
            <code className="font-mono">no-reply@mail.blyss.co.ke</code>. Links
            expire in 14 days.
          </p>
        </div>

        {lastCreatedUrl && (
          <div className="border border-primary/40 p-3 flex items-center gap-3">
            <p className="text-xs text-muted-foreground flex-1 truncate font-mono">
              {lastCreatedUrl}
            </p>
            <Button
              variant="link"
              onClick={copyUrl}
              className="h-auto px-0 text-xs font-mono uppercase tracking-[0.12em]"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">Pending · {pending.length}</p>
          <div className="border border-border divide-y divide-border">
            {pending.map((inv) => (
              <div key={inv._id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke(inv._id)}
                  className="h-auto px-1.5 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-[var(--destructive)]"
                >
                  <X className="size-3.5" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {accepted.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">Accepted · {accepted.length}</p>
          <div className="border border-border divide-y divide-border">
            {accepted.map((inv) => (
              <div key={inv._id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">{inv.role}</p>
                </div>
                <span className="eyebrow text-primary">
                  <Check className="size-3 inline mr-0.5" /> joined
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
