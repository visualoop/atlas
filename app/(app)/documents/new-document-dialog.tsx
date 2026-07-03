"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, User, Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

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
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            New document
          </p>
          <DialogTitle className="text-xl font-semibold">
            What are you drafting?
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a new document (proposal, quote, invoice, etc).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "h-8 px-3 rounded-md text-xs font-medium transition-colors",
                    kind === k.value
                      ? "bg-primary text-primary-foreground"
                      : "border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholderFor(kind)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          <PickerField
            label="Company"
            icon={<Building2 className="size-3.5" />}
            query={companyQuery}
            onQueryChange={setCompanyQuery}
            selected={!!companyId}
            onClear={() => setCompanyId(undefined)}
            options={companies?.map((c) => ({ id: c._id, label: c.name })) ?? []}
            onSelect={(id) => {
              setCompanyId(id as Id<"companies">);
              setCompanyQuery("");
            }}
          />

          <PickerField
            label="Contact"
            icon={<User className="size-3.5" />}
            query={contactQuery}
            onQueryChange={setContactQuery}
            selected={!!contactId}
            onClear={() => setContactId(undefined)}
            options={
              contacts?.map((c) => ({
                id: c._id,
                label: `${c.firstName}${c.lastName ? " " + c.lastName : ""}${c.email ? " — " + c.email : ""}`,
              })) ?? []
            }
            onSelect={(id) => {
              setContactId(id as Id<"contacts">);
              setContactQuery("");
            }}
          />
        </div>

        <DialogFooter className="border-t px-6 py-3 flex-row items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => !saving && onClose()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} size="sm" className="gap-1.5">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerField({
  label,
  icon,
  query,
  onQueryChange,
  selected,
  onClear,
  options,
  onSelect,
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
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          {icon}
        </div>
        <Input
          value={selected ? "✓ selected" : query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="pl-9 pr-9"
        />
        {selected && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-items-center text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {!selected && query.length >= 2 && options.length > 0 && (
        <ul className="rounded-md border bg-popover max-h-40 overflow-y-auto text-sm shadow-sm">
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
    case "proposal":
      return "e.g. Omnix rollout for Java House Nairobi";
    case "quote":
      return "e.g. Website redesign scope";
    case "invoice":
      return "e.g. Retainer — January 2026";
    case "contract":
      return "e.g. MSA — Blyss × Client";
    case "brief":
      return "e.g. Brand refresh brief";
    case "statement_of_work":
      return "e.g. Phase 1 SOW";
  }
}
