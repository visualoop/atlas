"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import {
  Home, Inbox, Users, Building2, Workflow, Search, FileText,
  Megaphone, BarChart3, Calendar, Settings, Plus, LogOut,
  ListTodo, StickyNote,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAV = [
  { href: "/today", icon: Home, label: "Today", key: "t" },
  { href: "/inbox", icon: Inbox, label: "Inbox", key: "i" },
  { href: "/contacts", icon: Users, label: "Contacts", key: "c" },
  { href: "/companies", icon: Building2, label: "Companies", key: "o" },
  { href: "/pipelines", icon: Workflow, label: "Pipelines", key: "p" },
  { href: "/prospector", icon: Search, label: "Prospector", key: "g" },
  { href: "/documents", icon: FileText, label: "Documents", key: "d" },
  { href: "/campaigns", icon: Megaphone, label: "Campaigns", key: "b" },
  { href: "/analytics", icon: BarChart3, label: "Analytics", key: "a" },
  { href: "/calendar", icon: Calendar, label: "Calendar", key: "k" },
  { href: "/settings/profile", icon: Settings, label: "Settings", key: "," },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();

  // Debounced search query
  const trimmed = query.trim();
  const results = useQuery(
    api.search.universal,
    trimmed.length >= 2 ? { q: trimmed, limitPerType: 6 } : "skip",
  );

  // Reset query on close
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setQuery(""), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const groupedResults = useMemo(() => {
    const groups = { company: [], contact: [], note: [], task: [] } as Record<string, any[]>;
    for (const hit of results ?? []) {
      groups[hit.type].push(hit);
    }
    return groups;
  }, [results]);

  function go(href: string) {
    router.push(href);
    onOpenChange(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search contacts, companies, notes, tasks — or run a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {trimmed.length >= 2 ? "Nothing found." : "Start typing to search."}
        </CommandEmpty>

        {/* Quick actions when no query */}
        {!trimmed && (
          <>
            <CommandGroup heading="Quick actions">
              <CommandItem onSelect={() => go("/contacts")}>
                <Plus className="size-4 mr-2" /> New contact
              </CommandItem>
              <CommandItem onSelect={() => go("/companies")}>
                <Plus className="size-4 mr-2" /> New company
              </CommandItem>
              <CommandItem onSelect={() => go("/settings/integrations")}>
                <Settings className="size-4 mr-2" /> Add an API key
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Search results */}
        {groupedResults.company.length > 0 && (
          <CommandGroup heading={`Companies · ${groupedResults.company.length}`}>
            {groupedResults.company.map((hit) => (
              <CommandItem
                key={hit.doc._id}
                value={`company-${hit.doc._id}-${hit.doc.name}`}
                onSelect={() => go(`/companies?open=${hit.doc._id}`)}
              >
                <Building2 className="size-4 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">{hit.doc.name}</span>
                <span className="eyebrow text-[10px] text-muted-foreground">
                  {hit.doc.lifecycleStage}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groupedResults.contact.length > 0 && (
          <CommandGroup heading={`Contacts · ${groupedResults.contact.length}`}>
            {groupedResults.contact.map((hit) => (
              <CommandItem
                key={hit.doc._id}
                value={`contact-${hit.doc._id}-${hit.doc.firstName}`}
                onSelect={() => go(`/contacts?open=${hit.doc._id}`)}
              >
                <Users className="size-4 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">
                  {hit.doc.firstName}
                  {hit.doc.lastName ? ` ${hit.doc.lastName}` : ""}
                </span>
                {hit.doc.email && (
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {hit.doc.email}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groupedResults.note.length > 0 && (
          <CommandGroup heading={`Notes · ${groupedResults.note.length}`}>
            {groupedResults.note.map((hit) => (
              <CommandItem
                key={hit.doc._id}
                value={`note-${hit.doc._id}`}
                onSelect={() => {
                  const target = hit.doc.relatedToType && hit.doc.relatedToId
                    ? `/${hit.doc.relatedToType === "company" ? "companies" : "contacts"}?open=${hit.doc.relatedToId}`
                    : "/today";
                  go(target);
                }}
              >
                <StickyNote className="size-4 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">
                  {hit.doc.title || hit.doc.bodyText.slice(0, 60)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groupedResults.task.length > 0 && (
          <CommandGroup heading={`Tasks · ${groupedResults.task.length}`}>
            {groupedResults.task.map((hit) => (
              <CommandItem
                key={hit.doc._id}
                value={`task-${hit.doc._id}-${hit.doc.title}`}
                onSelect={() => {
                  const target = hit.doc.relatedToType && hit.doc.relatedToId
                    ? `/${hit.doc.relatedToType === "company" ? "companies" : "contacts"}?open=${hit.doc.relatedToId}`
                    : "/today";
                  go(target);
                }}
              >
                <ListTodo className="size-4 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">{hit.doc.title}</span>
                <span className="eyebrow text-[10px] text-muted-foreground">
                  {hit.doc.status}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Navigate — always shown */}
        {!trimmed && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Navigate">
              {NAV.filter((n) => !pathname?.startsWith(n.href)).map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    onSelect={() => go(item.href)}
                    value={`nav-${item.label}`}
                  >
                    <Icon className="size-4 mr-2 text-muted-foreground" />
                    <span className="flex-1">{item.label}</span>
                    <span className="eyebrow text-[10px] text-muted-foreground">{item.key}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Account">
              <CommandItem
                onSelect={async () => {
                  await signOut();
                  router.push("/login");
                  router.refresh();
                }}
              >
                <LogOut className="size-4 mr-2 text-muted-foreground" />
                Sign out
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
