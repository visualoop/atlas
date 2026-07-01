"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Home,
  Inbox,
  Users,
  Building2,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommandPalette } from "@/components/atlas/command-palette";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

const SIDEBAR_ITEMS = [
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
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();

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

  if (bootstrap === undefined) {
    // Loading shell — skeleton would go here in a richer version
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (bootstrap === null) {
    // Authenticated middleware should have already redirected; guard anyway.
    return null;
  }

  // First-run: signed in but no org yet → show org creation wizard.
  if (!bootstrap.activeOrg) {
    return <FirstRunOrgWizard userName={bootstrap.user.name ?? ""} />;
  }

  const { user, activeOrg, activeWorkspace, organizations, workspaces } = bootstrap;
  const initials = (user.name || user.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-12 border-b border-border flex items-center px-3 gap-2 sticky top-0 bg-background/95 backdrop-blur z-50">
        <DropdownMenu>
          <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5">
            {activeOrg.name}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-none">
            <DropdownMenuLabel className="eyebrow">Organizations</DropdownMenuLabel>
            {organizations.map((o) => (
              <DropdownMenuItem key={o._id}>{o.name}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/onboarding/new-org")}>
              + Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeWorkspace && (
          <>
            <div className="w-px h-4 bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5">
                {activeWorkspace.name}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-none">
                <DropdownMenuLabel className="eyebrow">Workspaces</DropdownMenuLabel>
                {workspaces.map((w, i) => (
                  <DropdownMenuItem key={w._id}>
                    <span>{w.name}</span>
                    {i < 9 && (
                      <span className="ml-auto eyebrow text-muted-foreground">⌘{i + 1}</span>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/onboarding/new-workspace")}>
                  + New workspace
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-auto mr-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[280px] py-1.5 px-3 border border-border hover:border-border-strong"
        >
          <Search className="size-3.5" />
          <span>Search or run a command…</span>
          <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5">⌘K</span>
        </button>

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
            <DropdownMenuItem onClick={() => router.push("/settings/profile")}>Profile</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings/security")}>Security</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings/integrations")}>Integrations</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="size-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex-1 flex">
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
                  "size-10 flex items-center justify-center transition-colors hover:bg-muted",
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

        <main className="flex-1 min-w-0">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* First-run wizard — no org yet                                       */
/* ------------------------------------------------------------------ */

function FirstRunOrgWizard({ userName }: { userName: string }) {
  const createOrg = useMutation(api.organizations.createOrganization);
  const router = useRouter();
  const [orgName, setOrgName] = useState("Blyss");
  const [slug, setSlug] = useState("blyss");
  const [firstWs, setFirstWs] = useState("Studio");
  const [pending, setPending] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            await createOrg({ name: orgName, slug, firstWorkspaceName: firstWs });
            router.refresh();
          } finally {
            setPending(false);
          }
        }}
        className="w-full max-w-md space-y-8"
      >
        <header className="space-y-2">
          <p className="eyebrow">Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}</p>
          <h1 className="text-4xl tracking-tight">
            Set up your <em className="italic font-display">organization</em>.
          </h1>
          <p className="text-sm text-muted-foreground">
            An organization holds your workspaces, members, and integrations.
          </p>
        </header>

        <div className="space-y-2">
          <Label htmlFor="orgName" className="eyebrow">Organization name</Label>
          <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug" className="eyebrow">URL slug</Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            required
            pattern="[a-z0-9-]{2,40}"
          />
          <p className="text-xs text-muted-foreground">Lowercase letters, digits, hyphens.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="firstWs" className="eyebrow">First workspace</Label>
          <Input id="firstWs" value={firstWs} onChange={(e) => setFirstWs(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Add more workspaces later (Omnix, Marketplace, etc.).
          </p>
        </div>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "…" : "Create organization"}
        </Button>
      </form>
    </main>
  );
}
