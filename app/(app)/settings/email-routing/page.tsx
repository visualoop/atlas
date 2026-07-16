"use client";

import { useState, useMemo } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Mail, Trash2, Plus, CheckCircle2, AlertTriangle } from "lucide-react";

interface Zone {
  id: string;
  name: string;
  status: string;
  account?: { id: string; name?: string };
}

interface Rule {
  tag: string;
  name?: string;
  enabled: boolean;
  matchers: Array<{ type: string; field?: string; value?: string }>;
  actions: Array<{ type: string; value?: string[] }>;
}

interface Destination {
  id: string;
  tag: string;
  email: string;
  verified?: string | null;
}

export default function EmailRoutingPage() {
  const listZones = useAction(api.cloudflareEmailRoutingActions.listZones);
  const getStatus = useAction(api.cloudflareEmailRoutingActions.getZoneRoutingStatus);
  const enableRouting = useAction(api.cloudflareEmailRoutingActions.enableRouting);
  const listRules = useAction(api.cloudflareEmailRoutingActions.listRules);
  const addRule = useAction(api.cloudflareEmailRoutingActions.addRule);
  const deleteRule = useAction(api.cloudflareEmailRoutingActions.deleteRule);
  const listDests = useAction(api.cloudflareEmailRoutingActions.listDestinations);
  const addDest = useAction(api.cloudflareEmailRoutingActions.addDestination);

  const [zones, setZones] = useState<Zone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string>("");
  const [status, setStatus] = useState<{
    enabled: boolean;
    status?: string;
    zoneName?: string;
    mxReady?: boolean;
  } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleLocal, setRuleLocal] = useState("");
  const [ruleForwardTo, setRuleForwardTo] = useState("");
  const [newDestEmail, setNewDestEmail] = useState("");

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId),
    [zones, activeZoneId],
  );

  async function loadZones() {
    setLoading(true);
    setError(null);
    try {
      const res = await listZones({});
      setZones(res.zones);
      if (res.zones.length === 1) {
        void selectZone(res.zones[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zones.");
    } finally {
      setLoading(false);
    }
  }

  async function selectZone(zoneId: string) {
    setActiveZoneId(zoneId);
    setLoading(true);
    setError(null);
    try {
      const zone = zones.find((z) => z.id === zoneId);
      const [statusRes, rulesRes, destsRes] = await Promise.all([
        getStatus({ zoneId }),
        listRules({ zoneId }).catch(() => ({ rules: [] as Rule[] })),
        zone?.account?.id
          ? listDests({ accountId: zone.account.id }).catch(() => ({ destinations: [] as Destination[] }))
          : Promise.resolve({ destinations: [] as Destination[] }),
      ]);
      setStatus(statusRes);
      setRules(rulesRes.rules);
      setDestinations(destsRes.destinations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zone.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    if (!activeZoneId) return;
    setLoading(true);
    try {
      await enableRouting({ zoneId: activeZoneId });
      toast.success("Email Routing enabled. DNS records installed.");
      await selectZone(activeZoneId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddRule() {
    if (!activeZoneId || !ruleLocal.trim() || !ruleForwardTo.trim()) return;
    setLoading(true);
    try {
      await addRule({
        zoneId: activeZoneId,
        customAddress: ruleLocal.trim(),
        forwardTo: ruleForwardTo
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success("Rule added.");
      setRuleLocal("");
      setRuleForwardTo("");
      await selectZone(activeZoneId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRule(tag: string) {
    if (!activeZoneId) return;
    setLoading(true);
    try {
      await deleteRule({ zoneId: activeZoneId, tag });
      toast.success("Rule removed.");
      await selectZone(activeZoneId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddDestination() {
    if (!activeZone?.account?.id || !newDestEmail.trim()) return;
    setLoading(true);
    try {
      await addDest({
        accountId: activeZone.account.id,
        email: newDestEmail.trim(),
      });
      toast.success(
        `Verification email sent to ${newDestEmail.trim()}. Click the link to activate.`,
      );
      setNewDestEmail("");
      await selectZone(activeZoneId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/settings/integrations"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <p className="eyebrow">Settings · Integrations</p>
      </div>

      <div>
        <h1 className="font-display italic text-4xl tracking-tight">
          Email Routing
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-lg">
          Free inbound mail on your custom domain. Cloudflare receives at
          <span className="font-mono px-1">hello@yourdomain</span> and forwards
          to a verified Gmail / Resend inbox. Pair with Resend for two-way.
        </p>
      </div>

      {zones.length === 0 && (
        <div className="rounded-lg border border-border p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            Load the zones your Cloudflare token can see, then pick one to manage.
          </p>
          <Button onClick={loadZones} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Mail className="size-4 mr-2" />
            )}
            Load zones
          </Button>
          {error && (
            <p className="text-sm text-destructive flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </div>
      )}

      {zones.length > 0 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border p-4">
            <label className="eyebrow">Zone</label>
            <Select
              value={activeZoneId || "__none__"}
              onValueChange={(v) => selectZone(v && v !== "__none__" ? v : "")}
            >
              <SelectTrigger className="mt-2 w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Choose a zone…</SelectItem>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name} · {z.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeZoneId && status && (
            <>
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm">
                    <span className="font-mono">{status.zoneName ?? activeZone?.name}</span>
                    {status.enabled ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="size-3" />
                        Enabled · {status.status}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">
                        Not enabled
                      </span>
                    )}
                  </p>
                  {!status.enabled && (
                    <Button size="sm" onClick={handleEnable} disabled={loading}>
                      {loading && <Loader2 className="size-3 mr-2 animate-spin" />}
                      Enable Email Routing
                    </Button>
                  )}
                </div>
                {!status.mxReady && status.enabled && (
                  <p className="text-xs text-amber-600 flex gap-2">
                    <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                    MX records still propagating. Wait a few minutes.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display italic text-xl">Destinations</h2>
                  <p className="eyebrow">Verified forward targets</p>
                </div>
                <ul className="space-y-1.5">
                  {destinations.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-border/50"
                    >
                      <span className="font-mono">{d.email}</span>
                      {d.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="size-3" /> Verified
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600">Awaiting verify</span>
                      )}
                    </li>
                  ))}
                  {destinations.length === 0 && (
                    <li className="text-xs text-muted-foreground py-2">
                      No destinations yet. Add one below.
                    </li>
                  )}
                </ul>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="email"
                    placeholder="you@gmail.com"
                    value={newDestEmail}
                    onChange={(e) => setNewDestEmail(e.target.value)}
                  />
                  <Button
                    onClick={handleAddDestination}
                    disabled={loading || !newDestEmail.trim() || !activeZone?.account?.id}
                  >
                    {loading ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="size-4 mr-2" />
                    )}
                    Send verify
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display italic text-xl">Forwarding rules</h2>
                  <p className="eyebrow">{rules.length} active</p>
                </div>
                <ul className="space-y-1.5">
                  {rules.map((r) => {
                    const to = r.matchers.find((m) => m.field === "to")?.value ?? "*";
                    const forward = r.actions
                      .filter((a) => a.type === "forward")
                      .flatMap((a) => a.value ?? [])
                      .join(", ");
                    return (
                      <li
                        key={r.tag}
                        className="flex items-center justify-between gap-3 py-2 border-b border-border/50 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-mono truncate">{to}</p>
                          <p className="text-xs text-muted-foreground">
                            → {forward || "(no forwards)"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDeleteRule(r.tag)}
                          className="hover:text-destructive"
                          disabled={loading}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </li>
                    );
                  })}
                  {rules.length === 0 && (
                    <li className="text-xs text-muted-foreground py-2">
                      No rules yet.
                    </li>
                  )}
                </ul>
                <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                  <Input
                    placeholder="hello"
                    value={ruleLocal}
                    onChange={(e) => setRuleLocal(e.target.value)}
                    aria-label="Local address"
                  />
                  <Input
                    placeholder="you@gmail.com, ops@blyss.co.ke"
                    value={ruleForwardTo}
                    onChange={(e) => setRuleForwardTo(e.target.value)}
                    aria-label="Forward-to addresses"
                  />
                  <Button
                    onClick={handleAddRule}
                    disabled={
                      loading ||
                      !ruleLocal.trim() ||
                      !ruleForwardTo.trim() ||
                      !status.enabled
                    }
                  >
                    {loading ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="size-4 mr-2" />
                    )}
                    Add rule
                  </Button>
                </div>
                {!status.enabled && (
                  <p className="text-xs text-amber-600">
                    Enable Email Routing on this zone first before adding rules.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
