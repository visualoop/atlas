"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { X, Plus, Loader2, User, Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  pipelineId: Id<"pipelines">;
  onClose: () => void;
}

export function NewDealDialog({ pipelineId, onClose }: Props) {
  const stages = useQuery(api.pipelines.listStages, { pipelineId });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState("KES");
  const [expectedClose, setExpectedClose] = useState("");
  const [contactId, setContactId] = useState<Id<"contacts"> | undefined>();
  const [companyId, setCompanyId] = useState<Id<"companies"> | undefined>();
  const [saving, setSaving] = useState(false);

  const [contactQuery, setContactQuery] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const contacts = useQuery(
    api.contacts.list,
    contactQuery.length >= 2 ? { search: contactQuery, limit: 8 } : "skip",
  );
  const companies = useQuery(
    api.companies.list,
    companyQuery.length >= 2 ? { search: companyQuery, limit: 8 } : "skip",
  );

  const createDeal = useMutation(api.pipelines.createDeal);

  async function submit() {
    if (name.trim().length < 3) {
      toast.error("Give the deal a name.");
      return;
    }
    const amt = Number(amount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Invalid amount.");
      return;
    }
    const cents = BigInt(Math.round(amt * 100));
    setSaving(true);
    try {
      await createDeal({
        pipelineId,
        name: name.trim(),
        amountCents: cents,
        currency,
        contactId,
        companyId,
        expectedCloseDate: expectedClose ? new Date(expectedClose).getTime() : undefined,
      });
      toast.success("Deal created.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border flex items-start justify-between">
          <div>
            <p className="eyebrow font-mono text-muted-foreground">New deal</p>
            <h2 className="font-display italic text-2xl mt-1">What's the <em>opportunity</em>?</h2>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Java House Nairobi — Omnix rollout"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-[1fr_100px] gap-3">
            <Field label="Amount">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono num"
              />
            </Field>
            <Field label="Currency">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-9 px-2 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              >
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </Field>
          </div>

          <Field label="Expected close">
            <input
              type="date"
              value={expectedClose}
              onChange={(e) => setExpectedClose(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </Field>

          <Field label="Contact">
            <PickerInput
              value={contactId ? "Selected" : contactQuery}
              onChange={setContactQuery}
              placeholder="Search contacts…"
              icon={<User className="size-3.5" />}
              selected={contactId ? contactId : undefined}
              onClear={() => setContactId(undefined)}
            />
            {contactQuery.length >= 2 && contacts && contacts.length > 0 && !contactId && (
              <ul className="mt-1 border border-border bg-background max-h-40 overflow-y-auto text-sm">
                {contacts.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => { setContactId(c._id); setContactQuery(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      {c.firstName}{c.lastName ? ` ${c.lastName}` : ""} — {c.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field label="Company">
            <PickerInput
              value={companyId ? "Selected" : companyQuery}
              onChange={setCompanyQuery}
              placeholder="Search companies…"
              icon={<Building2 className="size-3.5" />}
              selected={companyId ? companyId : undefined}
              onClear={() => setCompanyId(undefined)}
            />
            {companyQuery.length >= 2 && companies && companies.length > 0 && !companyId && (
              <ul className="mt-1 border border-border bg-background max-h-40 overflow-y-auto text-sm">
                {companies.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => { setCompanyId(c._id); setCompanyQuery(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function PickerInput({
  value, onChange, placeholder, icon, selected, onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  selected?: string;
  onClear?: () => void;
}) {
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon}
      </div>
      <input
        value={selected ? "✓ selected" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-9 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
      />
      {selected && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
