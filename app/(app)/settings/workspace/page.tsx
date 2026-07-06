"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /settings/workspace — brand + product context that every AI feature reads.
 *
 * All fields optional. Filled-in fields prefix every AI prompt (Copilot,
 * campaign runner, meeting brief, rotting-deal classifier, trend intelligence).
 */

export default function WorkspacePage() {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const update = useMutation(api.organizations.updateWorkspace);

  const ws = bootstrap?.activeWorkspace;
  const [values, setValues] = useState({
    name: "",
    description: "",
    website: "",
    oneLiner: "",
    elevatorPitch: "",
    offerings: "",
    targetMarket: "",
    brandVoice: "",
    coreValues: "",
    pricingSummary: "",
    assistantName: "",
    assistantPersonaTraits: "",
    emailHeaderHtml: "",
    emailFooterHtml: "",
    emailAccentColor: "",
    prospectorDailyCap: 100,
    googleMapsDailySearchCap: 150,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ws) return;
    setValues({
      name: ws.name ?? "",
      description: ws.description ?? "",
      website: ws.website ?? "",
      oneLiner: ws.oneLiner ?? "",
      elevatorPitch: ws.elevatorPitch ?? "",
      offerings: ws.offerings ?? "",
      targetMarket: ws.targetMarket ?? "",
      brandVoice: ws.brandVoice ?? "",
      coreValues: ws.coreValues ?? "",
      pricingSummary: ws.pricingSummary ?? "",
      assistantName: ws.assistantName ?? "",
      assistantPersonaTraits: ws.assistantPersonaTraits ?? "",
      emailHeaderHtml: ws.emailHeaderHtml ?? "",
      emailFooterHtml: ws.emailFooterHtml ?? "",
      emailAccentColor: ws.emailAccentColor ?? "",
      prospectorDailyCap: ws.prospectorDailyCap ?? 100,
      googleMapsDailySearchCap: ws.googleMapsDailySearchCap ?? 150,
    });
  }, [ws]);

  async function save() {
    if (!ws) return;
    setSaving(true);
    try {
      await update({
        id: ws._id,
        patch: {
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          website: values.website.trim() || undefined,
          oneLiner: values.oneLiner.trim() || undefined,
          elevatorPitch: values.elevatorPitch.trim() || undefined,
          offerings: values.offerings.trim() || undefined,
          targetMarket: values.targetMarket.trim() || undefined,
          brandVoice: values.brandVoice.trim() || undefined,
          coreValues: values.coreValues.trim() || undefined,
          pricingSummary: values.pricingSummary.trim() || undefined,
          assistantName: values.assistantName.trim() || undefined,
          assistantPersonaTraits: values.assistantPersonaTraits.trim() || undefined,
          emailHeaderHtml: values.emailHeaderHtml.trim() || undefined,
          emailFooterHtml: values.emailFooterHtml.trim() || undefined,
          emailAccentColor: values.emailAccentColor.trim() || undefined,
          prospectorDailyCap: values.prospectorDailyCap,
          googleMapsDailySearchCap: values.googleMapsDailySearchCap,
        },
      });
      toast.success("Workspace saved. AI features will use this from the next turn.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!bootstrap || !ws) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">
          <Sparkles className="size-3 inline mr-1 text-primary" />
          Workspace context — feeds every AI feature
        </p>
        <p className="text-sm text-muted-foreground max-w-prose">
          Fill in what you sell, who you sell to, and how you talk. The Copilot,
          campaign runner, pre-meeting brief, rotting-deal classifier, and social
          post generator all read this so they don't hallucinate about your
          business. Save changes and the next AI turn uses them.
        </p>
      </header>

      <section className="space-y-5 border border-border p-6">
        <Field label="Workspace name" required>
          <input
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
          />
        </Field>

        <Field label="Website" hint="Used for AI research + brand context">
          <input
            value={values.website}
            onChange={(e) => setValues({ ...values, website: e.target.value })}
            placeholder="https://omnix.blyss.co.ke"
            className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
          />
        </Field>

        <Field label="One-liner" hint="How you describe this workspace in one line">
          <input
            value={values.oneLiner}
            onChange={(e) => setValues({ ...values, oneLiner: e.target.value })}
            placeholder="M-PESA POS for salons + spas in Nairobi"
            className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            maxLength={140}
          />
        </Field>

        <Field label="Elevator pitch" hint="2-3 sentences the AI can reuse in cold-emails">
          <textarea
            rows={3}
            value={values.elevatorPitch}
            onChange={(e) => setValues({ ...values, elevatorPitch: e.target.value })}
            placeholder="Omnix is an all-in-one POS + inventory system built for Kenyan retail. We handle M-PESA reconciliation automatically and support offline mode for kiosks with unstable internet."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
          />
        </Field>
      </section>

      <section className="space-y-5 border border-border p-6">
        <p className="eyebrow">Product + market</p>

        <Field label="Offerings" hint="Markdown list of what you sell">
          <textarea
            rows={5}
            value={values.offerings}
            onChange={(e) => setValues({ ...values, offerings: e.target.value })}
            placeholder={"- Omnix POS terminal + till software\n- Omnix Inventory (SKU management + reorder alerts)\n- Omnix Loyalty (customer rewards via WhatsApp)"}
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none font-mono"
          />
        </Field>

        <Field label="Ideal customer" hint="Who this workspace serves">
          <textarea
            rows={3}
            value={values.targetMarket}
            onChange={(e) => setValues({ ...values, targetMarket: e.target.value })}
            placeholder="Independent salon + spa owners in Kenya, 3-15 staff, KES 200k-2m monthly revenue, using paper receipts or WhatsApp bookings today."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
          />
        </Field>

        <Field label="Pricing summary" hint="Short — full pricing lives in Documents">
          <textarea
            rows={3}
            value={values.pricingSummary}
            onChange={(e) => setValues({ ...values, pricingSummary: e.target.value })}
            placeholder="KES 3,500 / terminal / month. Setup + training KES 15k one-off. 14-day free trial. No lock-in."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
          />
        </Field>
      </section>

      <section className="space-y-5 border border-border p-6">
        <p className="eyebrow">Voice + values</p>

        <Field label="Brand voice" hint="How the AI should sound. Keep it specific.">
          <textarea
            rows={3}
            value={values.brandVoice}
            onChange={(e) => setValues({ ...values, brandVoice: e.target.value })}
            placeholder="Confident, direct, Kenyan English. Never marketing fluff. No 'delve', 'hope this finds you', or em-dash filler. Use 'sawa' + 'karibu' naturally when messaging local prospects."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
          />
        </Field>

        <Field label="Core values" hint="Optional. Shapes long-form copy.">
          <textarea
            rows={3}
            value={values.coreValues}
            onChange={(e) => setValues({ ...values, coreValues: e.target.value })}
            placeholder="- Ship weekly. If it's not in prod it doesn't count.\n- Serve founders, not enterprises.\n- Kenya-first, not Kenya-only."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none font-mono"
          />
        </Field>
      </section>

      <section className="space-y-5 border border-border p-6">
        <p className="eyebrow">Prospector guardrails</p>

        <Field
          label="Daily import cap"
          hint="Max Places imports per day. Stops the AI (and yourself) from burning through Google credits by accident."
        >
          <input
            type="number"
            min={1}
            max={5000}
            value={values.prospectorDailyCap}
            onChange={(e) =>
              setValues({
                ...values,
                prospectorDailyCap: Math.max(1, Math.min(5000, Number(e.target.value) || 100)),
              })
            }
            className="w-32 h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono num"
          />
        </Field>

        <Field
          label="Google Maps search cap (per day)"
          hint="Hard ceiling on Places API calls. 150/day = ~4,500/month, ~72% of Google's $200/mo free credit. This cap keeps you safely inside free tier forever. Bump to 200 if you want more headroom, or drop to 50 to stay ultra-safe."
        >
          <input
            type="number"
            min={1}
            max={11000}
            value={values.googleMapsDailySearchCap}
            onChange={(e) =>
              setValues({
                ...values,
                googleMapsDailySearchCap: Math.max(1, Math.min(11000, Number(e.target.value) || 150)),
              })
            }
            className="w-32 h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono num"
          />
        </Field>
      </section>

      <section className="space-y-5 border border-border p-6">
        <div>
          <p className="eyebrow">
            <Sparkles className="size-3 inline mr-1 text-primary" />
            Your assistant
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">
            Name your AI assistant and describe how they should sound.
            Applied everywhere — Copilot header, generated emails,
            WhatsApp drafts, the daily briefing. Blank fields fall
            back to "Atlas" with the standard Kenyan-English voice.
          </p>
        </div>
        <Field
          label="Assistant name"
          hint="What should we call your AI assistant?"
        >
          <input
            value={values.assistantName}
            onChange={(e) =>
              setValues({ ...values, assistantName: e.target.value })
            }
            placeholder="Atlas"
            className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            maxLength={40}
          />
        </Field>
        <Field
          label="How should they sound?"
          hint="Freeform character notes the AI weaves into responses"
        >
          <textarea
            rows={3}
            value={values.assistantPersonaTraits}
            onChange={(e) =>
              setValues({
                ...values,
                assistantPersonaTraits: e.target.value,
              })
            }
            placeholder="Direct, warm, uses Sheng occasionally. Never uses corporate jargon. Confident but never salesy. Always signs off with the founder's first name only."
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none"
          />
        </Field>
      </section>

      <section className="space-y-5 border border-border p-6">
        <div>
          <p className="eyebrow">
            <Sparkles className="size-3 inline mr-1 text-primary" />
            Email chrome
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">
            Header + footer HTML wrapped around every outbound email
            template. Leave blank for a sensible auto-generated default
            (workspace name in the header, website + unsubscribe in the
            footer). Uses your accent color for the header rule.
          </p>
        </div>
        <Field
          label="Accent colour (hex)"
          hint="Used for the header rule + link colour. Blank = #111827."
        >
          <input
            value={values.emailAccentColor}
            onChange={(e) =>
              setValues({ ...values, emailAccentColor: e.target.value })
            }
            placeholder="#111827"
            className="w-32 h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
            maxLength={9}
          />
        </Field>
        <Field
          label="Custom header HTML"
          hint="Optional. Overrides the auto-generated header. Inline styles only — most email clients strip <style>."
        >
          <textarea
            rows={5}
            value={values.emailHeaderHtml}
            onChange={(e) =>
              setValues({ ...values, emailHeaderHtml: e.target.value })
            }
            placeholder={`<div style="border-bottom: 2px solid #111827; padding: 12px 0;">…</div>`}
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none font-mono"
          />
        </Field>
        <Field
          label="Custom footer HTML"
          hint="Optional. Overrides the auto-generated footer. Same inline-styles rule."
        >
          <textarea
            rows={5}
            value={values.emailFooterHtml}
            onChange={(e) =>
              setValues({ ...values, emailFooterHtml: e.target.value })
            }
            placeholder={`<div style="border-top: 1px solid #e5e7eb; margin-top: 32px;…">…</div>`}
            className="w-full px-3 py-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none resize-none font-mono"
          />
        </Field>
      </section>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={save}
          disabled={saving || !values.name.trim()}
          className="inline-flex items-center gap-1.5 h-10 px-6 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] disabled:opacity-50 active:scale-[0.97] transition-transform"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save workspace
        </button>
        <p className="text-xs text-muted-foreground">
          Changes are live immediately for every AI feature.
        </p>
      </div>
    </div>
  );
}

function Field({
  label, hint, required, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">{label}{required && " *"}</span>
        {hint && <span className="text-[11px] text-muted-foreground italic">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
