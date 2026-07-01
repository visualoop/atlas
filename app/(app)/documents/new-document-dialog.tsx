"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, User, Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "proposal", label: "Proposal" },
  { value: "quote", label: "Quote" },
  { value: "invoice", label: "Invoice" },
  { value: "contract", label: "Contract" },
  { value: "brief", label: "Brief" },
  { value: "statement_of_work", label: "SOW" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

export function NewDocumentDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("proposal");
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState<Id<"companies"> | undefined>();
  const [contactId, setContactId] = useState<Id<"contacts"> | undefined>();
  const [saving, setSaving] = useState(false);

  const [companyQuery, setCompanyQuery] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const companies = useQuery(
    api.companies.list,
    companyQuery.length >= 2 ? { search: companyQuery, limit: 8 } : "skip",
  );
  const contacts = useQuery(
    api.contacts.list,
    contactQuery.length >= 2 ? { search: contactQuery, limit: 8 } : "skip",
  );

  const createDoc = useMutation(api.documents.createDocument);

  async function submit() {
    if (title.trim().length < 3) {
      toast.error("Give it a title.");
      return;
    }
    setSaving(true);
    try {
      const id = await createDoc({
        kind,
        title: title.trim(),
        contactId,
        companyId,
      });
      toast.success("Created.");
      router.push(`/documents/${id}`);
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
            <p className="eyebrow font-mono text-muted-foreground">New document</p>
            <h2 className="font-display italic text-2xl mt-1">What are you <em>drafting</em>?</h2>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="size-8 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Kind
            </span>
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] transition-colors",
                    kind === k.value
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Title
            </span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholderFor(kind)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </label>

          <PickerField
            label="Company"
            icon={<Building2 className="size-3.5" />}
            query={companyQuery}
            onQueryChange={setCompanyQuery}
            selected={!!companyId}
            onClear={() => setCompanyId(undefined)}
            options={companies?.map((c) => ({ id: c._id, label: c.name })) ?? []}
            onSelect={(id) => { setCompanyId(id as Id<"companies">); setCompanyQuery(""); }}
          />

          <PickerField
            label="Contact"
            icon={<User className="size-3.5" />}
            query={contactQuery}
            onQueryChange={setContactQuery}
            selected={!!contactId}
            onClear={() => setContactId(undefined)}
            options={contacts?.map((c) => ({
              id: c._id,
              label: `${c.firstName}${c.lastName ? " " + c.lastName : ""}${c.email ? " — " + c.email : ""}`,
            })) ?? []}
            onSelect={(id) => { setContactId(id as Id<"contacts">); setContactQuery(""); }}
          />
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

function PickerField({
  label, icon, query, onQueryChange, selected, onClear, options, onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  query: string;
  onQueryChange: (v: string) => void;
  selected: boolean;
  onClear: () => void;
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="block space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </div>
        <input
          value={selected ? "✓ selected" : query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
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
      {!selected && query.length >= 2 && options.length > 0 && (
        <ul className="border border-border bg-background max-h-40 overflow-y-auto text-sm">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onSelect(o.id)}
                className="w-full text-left px-3 py-2 hover:bg-muted"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function placeholderFor(kind: Kind): string {
  switch (kind) {
    case "proposal": return "e.g. Omnix rollout for Java House Nairobi";
    case "quote": return "e.g. Website redesign scope";
    case "invoice": return "e.g. Retainer — January 2026";
    case "contract": return "e.g. MSA — Blyss × Client";
    case "brief": return "e.g. Brand refresh brief";
    case "statement_of_work": return "e.g. Phase 1 SOW";
  }
}
