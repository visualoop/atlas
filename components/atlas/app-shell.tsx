"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Inbox,
  Users,
  Workflow,
  Search,
  FileText,
  Megaphone,
  BarChart3,
  Calendar,
  Settings,
  LogOut,
  ChevronDown,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

const SIDEBAR_ITEMS = [
  { href: "/today", icon: Home, label: "Today", key: "t" },
  { href: "/inbox", icon: Inbox, label: "Inbox", key: "i" },
  { href: "/contacts", icon: Users, label: "Contacts", key: "c" },
  { href: "/pipelines", icon: Workflow, label: "Pipelines", key: "p" },
  { href: "/prospector", icon: Search, label: "Prospector", key: "g" },
  { href: "/documents", icon: FileText, label: "Documents", key: "d" },
  { href: "/campaigns", icon: Megaphone, label: "Campaigns", key: "b" },
  { href: "/analytics", icon: BarChart3, label: "Analytics", key: "a" },
  { href: "/calendar", icon: Calendar, label: "Calendar", key: "k" },
];

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // ⌘K opens palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = (user.name || user.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* === Topbar === */}
      <header className="h-12 border-b border-border flex items-center px-3 gap-2 sticky top-0 bg-background/95 backdrop-blur z-50">
        {/* Org switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5">
            Blyss
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-none">
            <DropdownMenuLabel className="eyebrow">Organizations</DropdownMenuLabel>
            <DropdownMenuItem>Blyss</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>+ Create organization</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-4 bg-border" />

        {/* Workspace switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5">
            Omnix
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-none">
            <DropdownMenuLabel className="eyebrow">Workspaces</DropdownMenuLabel>
            <DropdownMenuItem>
              <span>Omnix</span>
              <span className="ml-auto eyebrow text-muted-foreground">⌘1</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span>Marketplace</span>
              <span className="ml-auto eyebrow text-muted-foreground">⌘2</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span>Studio</span>
              <span className="ml-auto eyebrow text-muted-foreground">⌘3</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Palette opener (center) */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-auto mr-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[280px] py-1.5 px-3 border border-border hover:border-border-strong"
        >
          <Search className="size-3.5" />
          <span>Search or run a command…</span>
          <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5">⌘K</span>
        </button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-auto">
            <Avatar className="size-7 rounded-none">
              <AvatarFallback className="rounded-none bg-muted text-xs font-mono">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-none w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm">{user.name}</span>
              <span className="text-xs text-muted-foreground font-normal">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings/security")}>
              Security
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings/integrations")}>
              Integrations
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="size-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex-1 flex">
        {/* === Sidebar === */}
        <nav className="w-14 border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={`${item.label} (${item.key})`}
                className={cn(
                  "size-10 flex items-center justify-center transition-colors",
                  "hover:bg-muted",
                  active && "text-primary border-l-2 border-primary",
                )}
              >
                <Icon className="size-4" />
              </Link>
            );
          })}
          <div className="flex-1" />
          <Link
            href="/settings"
            title="Settings"
            className={cn(
              "size-10 flex items-center justify-center transition-colors hover:bg-muted",
              pathname?.startsWith("/settings") && "text-primary border-l-2 border-primary",
            )}
          >
            <Settings className="size-4" />
          </Link>
        </nav>

        {/* === Main === */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* === Command Palette === */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search or run a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  onSelect={() => {
                    router.push(item.href);
                    setPaletteOpen(false);
                  }}
                >
                  <Icon className="size-4 mr-2" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Workspace">
            <CommandItem onSelect={() => setPaletteOpen(false)}>Switch to Omnix</CommandItem>
            <CommandItem onSelect={() => setPaletteOpen(false)}>Switch to Marketplace</CommandItem>
            <CommandItem onSelect={() => setPaletteOpen(false)}>Switch to Studio</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Account">
            <CommandItem onSelect={() => router.push("/settings/profile")}>Open settings</CommandItem>
            <CommandItem onSelect={handleSignOut}>Sign out</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
