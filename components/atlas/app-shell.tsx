"use client";

import { useState, useEffect } from "react";
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
  Sparkles,
  Megaphone,
  Share2,
  BookOpen,
  Zap,
  TrendingUp,
  BarChart3,
  Calendar,
  Settings,
  LogOut,
  ChevronDown,
  User as UserIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommandPalette } from "@/components/atlas/command-palette";
import { CopilotPanel } from "@/components/atlas/copilot-panel";
import { AppShellSkeleton } from "@/components/atlas/app-shell-skeleton";
import { NotificationSubscriber } from "@/components/atlas/notification-subscriber";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  key: string;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/today", icon: Home, label: "Today", key: "t" },
  { href: "/inbox", icon: Inbox, label: "Inbox", key: "i" },
];

const CRM_NAV: NavItem[] = [
  { href: "/contacts", icon: Users, label: "Contacts", key: "c" },
  { href: "/companies", icon: Building2, label: "Companies", key: "o" },
  { href: "/pipelines", icon: Workflow, label: "Pipelines", key: "p" },
  { href: "/prospector", icon: Search, label: "Prospector", key: "g" },
  { href: "/outreach/queue", icon: Sparkles, label: "Outreach queue", key: "q" },
];

const WORK_NAV: NavItem[] = [
  { href: "/documents", icon: FileText, label: "Documents", key: "d" },
  { href: "/vault", icon: Sparkles, label: "Vault", key: "v" },
  { href: "/calendar", icon: Calendar, label: "Calendar", key: "k" },
  { href: "/automations", icon: Zap, label: "Automations", key: "u" },
];

const GROWTH_NAV: NavItem[] = [
  { href: "/campaigns", icon: Megaphone, label: "Campaigns", key: "b" },
  { href: "/social", icon: Share2, label: "Social", key: "s" },
  { href: "/content", icon: BookOpen, label: "Content", key: "n" },
  { href: "/trends", icon: TrendingUp, label: "Trends", key: "r" },
  { href: "/analytics", icon: BarChart3, label: "Analytics", key: "a" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const bootstrapProfile = useMutation(api.referrals.bootstrapMyProfile);
  const setActiveWorkspace = useMutation(api.organizations.setActiveWorkspace);
  const setActiveOrganization = useMutation(api.organizations.setActiveOrganization);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();

  // Bootstrap profile + claim any pending referral code
  useEffect(() => {
    if (bootstrap === undefined || bootstrap === null) return;
    const stored = typeof window !== "undefined"
      ? window.sessionStorage.getItem("atlas_ref_code")
      : null;
    bootstrapProfile({ referralCode: stored ?? undefined })
      .then((res) => {
        if (res.claim.claimed && typeof window !== "undefined") {
          window.sessionStorage.removeItem("atlas_ref_code");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap === undefined ? undefined : bootstrap === null ? null : bootstrap.user?._id]);

  // ⌘K / Ctrl+K opens command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setCopilotOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (bootstrap === undefined) {
    return <AppShellSkeleton />;
  }
  if (bootstrap === null) return null;

  if (!bootstrap.activeOrg) {
    return <FirstRunOrgWizard userName={bootstrap.user.name ?? ""} />;
  }

  const { user, activeOrg, activeWorkspace, organizations, workspaces } = bootstrap;
  const displayName = user.name || user.email || "User";
  const initials = displayName
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <TooltipProvider>
      <NotificationSubscriber />
      <SidebarProvider defaultOpen={true}>
        <AtlasSidebar
          pathname={pathname ?? ""}
          activeOrg={activeOrg}
          organizations={organizations}
          onNewOrg={() => router.push("/onboarding/new-org")}
          onNavigate={(href) => router.push(href)}
          onSwitchOrg={async (id) => {
            try {
              await setActiveOrganization({ organizationId: id as Id<"organizations"> });
              router.refresh();
            } catch {}
          }}
        />

        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-40 h-12 border-b border-border flex items-center px-2 md:px-3 gap-2 bg-background/95 backdrop-blur">
            <SidebarTrigger className="size-9" />

            {activeWorkspace && (
              <>
                <div className="w-px h-4 bg-border" />
                <DropdownMenu>
                  <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5 max-w-[35vw] truncate rounded-none">
                    <span className="truncate">{activeWorkspace.name}</span>
                    <ChevronDown className="size-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="rounded-none min-w-[220px]">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="eyebrow">Workspaces</DropdownMenuLabel>
                      {workspaces.map((w, i) => (
                        <DropdownMenuItem
                          key={w._id}
                          onClick={async () => {
                            try {
                              await setActiveWorkspace({ workspaceId: w._id as Id<"workspaces"> });
                              router.refresh();
                            } catch {}
                          }}
                        >
                          <span className="flex-1 truncate">{w.name}</span>
                          {i < 9 && (
                            <span className="ml-2 eyebrow text-muted-foreground">⌘{i + 1}</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
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
              className="hidden md:flex mx-auto items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[240px] max-w-[420px] py-1.5 px-3 border border-border hover:border-[var(--border-strong)]"
            >
              <Search className="size-3.5 shrink-0" />
              <span className="truncate">Search or run a command…</span>
              <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5 shrink-0">⌘K</span>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="md:hidden ml-auto size-9 grid place-items-center hover:bg-muted"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>

            <button
              onClick={() => setCopilotOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] border border-[var(--border-strong)] hover:border-primary hover:text-primary transition-colors"
              title="Copilot (⌘J)"
            >
              <Sparkles className="size-3.5" />
              Copilot
              <span className="font-mono text-[10px] bg-muted px-1 py-0.5">⌘J</span>
            </button>
            <button
              onClick={() => setCopilotOpen(true)}
              className="md:hidden size-9 grid place-items-center hover:bg-muted"
              aria-label="Copilot"
            >
              <Sparkles className="size-4" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="ml-1 md:ml-auto size-8 grid place-items-center hover:bg-muted transition-colors text-xs font-mono border border-border rounded-none"
                aria-label="Account menu"
              >
                <span aria-hidden="true">{initials}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-none w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col gap-0.5">
                    <span className="text-sm truncate">{displayName}</span>
                    {user.email && (
                      <span className="text-xs text-muted-foreground font-normal truncate">
                        {user.email}
                      </span>
                    )}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
                  <UserIcon className="size-3.5 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings/security")}>
                  Security
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings/integrations")}>
                  Integrations
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings/referrals")}>
                  Referrals
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-[var(--danger)]">
                  <LogOut className="size-3.5 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="flex-1 min-w-0">{children}</div>
        </SidebarInset>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        {copilotOpen && <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />}
      </SidebarProvider>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function AtlasSidebar({
  pathname,
  activeOrg,
  organizations,
  onNewOrg,
  onNavigate,
  onSwitchOrg,
}: {
  pathname: string;
  activeOrg: { _id: string; name: string; slug: string };
  organizations: Array<{ _id: string; name: string }>;
  onNewOrg: () => void;
  onNavigate: (href: string) => void;
  onSwitchOrg: (id: string) => void;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent transition-colors text-left group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5"
          >
            <div className="flex aspect-square size-8 items-center justify-center bg-primary text-primary-foreground shrink-0">
              <span className="font-display italic text-lg leading-none">
                {activeOrg.name[0].toUpperCase()}
              </span>
            </div>
            <div className="grid flex-1 text-left leading-tight min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{activeOrg.name}</span>
              <span className="truncate text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {activeOrg.slug}
              </span>
            </div>
            <ChevronDown className="ml-auto size-3.5 shrink-0 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="rounded-none min-w-[220px]"
            align="start"
            side="right"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="eyebrow">Organizations</DropdownMenuLabel>
              {organizations.map((o) => (
                <DropdownMenuItem
                  key={o._id}
                  onClick={() => onSwitchOrg(o._id)}
                >
                  {o.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onNewOrg}>+ Create organization</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup label="" items={PRIMARY_NAV} pathname={pathname} onNavigate={onNavigate} />
        <NavGroup label="CRM" items={CRM_NAV} pathname={pathname} onNavigate={onNavigate} />
        <NavGroup label="Work" items={WORK_NAV} pathname={pathname} onNavigate={onNavigate} />
        <NavGroup label="Growth" items={GROWTH_NAV} pathname={pathname} onNavigate={onNavigate} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={pathname.startsWith("/settings")}
              className="rounded-none"
              onClick={() => onNavigate("/settings")}
            >
              <Settings className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <SidebarGroup>
      {label && (
        <SidebarGroupLabel className="font-mono uppercase tracking-[0.12em] text-[10px]">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  tooltip={item.label}
                  isActive={active}
                  className="rounded-none"
                  onClick={() => onNavigate(item.href)}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                  <span className="ml-auto font-mono uppercase text-[10px] text-muted-foreground/60 tracking-[0.12em] group-data-[collapsible=icon]:hidden">
                    {item.key}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/* ------------------------------------------------------------------ */
/* First-run wizard                                                     */
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
