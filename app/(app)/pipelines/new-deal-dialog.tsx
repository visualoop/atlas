"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { X, Plus, Loader2, User, Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  pipelineId: Id<"pipelines">;
  onClose: () => void;
}

export function NewDealDialog({ pipelineId, onClose }: Props) {
  useQuery(api.pipelines.listStages, { pipelineId }); // prefetch stages
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
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            New deal
          </p>
          <DialogTitle className="text-xl font-semibold">
            What&apos;s the opportunity?
          </DialogTitle>
          <DialogDescription className="sr-only">
            Create a new deal in the current pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Java House Nairobi — Omnix rollout"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="font-mono num"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KES">KES</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Expected close</Label>
            <Input
              type="date"
              value={expectedClose}
              onChange={(e) => setExpectedClose(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Contact</Label>
            <PickerField
              value={contactId ? "✓ selected" : contactQuery}
              onChange={setContactQuery}
              placeholder="Search contacts…"
              icon={<User className="size-3.5" />}
              hasSelection={!!contactId}
              onClear={() => setContactId(undefined)}
            />
            {contactQuery.length >= 2 && contacts && contacts.length > 0 && !contactId && (
              <ul className="rounded-md border bg-popover max-h-40 overflow-y-auto text-sm shadow-sm">
                {contacts.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => {
                        setContactId(c._id);
                        setContactQuery("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      {c.firstName}
                      {c.lastName ? ` ${c.lastName}` : ""} — {c.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Company</Label>
            <PickerField
              value={companyId ? "✓ selected" : companyQuery}
              onChange={setCompanyQuery}
              placeholder="Search companies…"
              icon={<Building2 className="size-3.5" />}
              hasSelection={!!companyId}
              onClear={() => setCompanyId(undefined)}
            />
            {companyQuery.length >= 2 && companies && companies.length > 0 && !companyId && (
              <ul className="rounded-md border bg-popover max-h-40 overflow-y-auto text-sm shadow-sm">
                {companies.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyId(c._id);
                        setCompanyQuery("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
  value,
  onChange,
  placeholder,
  icon,
  hasSelection,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  hasSelection?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        {icon}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {hasSelection && (
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
  );
}
