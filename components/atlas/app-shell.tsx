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
  Sparkles,
  Megaphone,
  Share2,
  BookOpen,
  TrendingUp,
  BarChart3,
  Calendar,
  Settings,
  LogOut,
  ChevronDown,
  PanelLeft,
  Menu,
  X,
  User as UserIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommandPalette } from "@/components/atlas/command-palette";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  key: string;
};

const SIDEBAR_ITEMS: NavItem[] = [
  { href: "/today", icon: Home, label: "Today", key: "t" },
  { href: "/inbox", icon: Inbox, label: "Inbox", key: "i" },
  { href: "/contacts", icon: Users, label: "Contacts", key: "c" },
  { href: "/companies", icon: Building2, label: "Companies", key: "o" },
  { href: "/pipelines", icon: Workflow, label: "Pipelines", key: "p" },
  { href: "/prospector", icon: Search, label: "Prospector", key: "g" },
  { href: "/documents", icon: FileText, label: "Documents", key: "d" },
  { href: "/vault", icon: Sparkles, label: "Vault", key: "v" },
  { href: "/campaigns", icon: Megaphone, label: "Campaigns", key: "b" },
  { href: "/social", icon: Share2, label: "Social", key: "s" },
  { href: "/content", icon: BookOpen, label: "Content", key: "n" },
  { href: "/trends", icon: TrendingUp, label: "Trends", key: "r" },
  { href: "/analytics", icon: BarChart3, label: "Analytics", key: "a" },
  { href: "/calendar", icon: Calendar, label: "Calendar", key: "k" },
];

const SIDEBAR_STATE_KEY = "atlas_sidebar_expanded";

export function AppShell({ children }: { children: React.ReactNode }) {
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const bootstrapProfile = useMutation(api.referrals.bootstrapMyProfile);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();

  // Load persisted sidebar state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (stored === "true") setSidebarExpanded(true);
  }, []);

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

  // Keyboard shortcuts: ⌘K palette, ⌘\ toggle sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  function toggleSidebar() {
    setSidebarExpanded((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_STATE_KEY, String(next));
      }
      return next;
    });
  }

  if (bootstrap === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
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
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Fixed top bar */}
      <header className="h-12 border-b border-border flex items-center px-2 md:px-3 gap-1 md:gap-2 sticky top-0 bg-background/95 backdrop-blur z-50">
        {/* Mobile: hamburger */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden size-9 grid place-items-center hover:bg-muted"
          aria-label="Open menu"
        >
          <Menu className="size-4" />
        </button>

        {/* Desktop: sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="hidden md:grid size-9 place-items-center hover:bg-muted text-muted-foreground"
          aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
          title={`${sidebarExpanded ? "Collapse" : "Expand"} sidebar (⌘\\)`}
        >
          <PanelLeft className="size-4" />
        </button>

        {/* Org picker */}
        <DropdownMenu>
          <DropdownMenuTrigger className="font-mono uppercase tracking-[0.12em] text-[11px] md:text-xs px-2 py-1 hover:bg-muted transition-colors inline-flex items-center gap-1.5 max-w-[35vw] truncate">
            <span className="truncate">{activeOrg.name}</span>
            <ChevronDown className="size-3 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-none min-w-[220px]">
            <DropdownMenuLabel className="eyebrow">Organizations</DropdownMenuLabel>
            {organizations.map((o) => (
              <DropdownMenuItem key={o._id}>{o.name}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/onboarding/new-org")}>
              + Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeWorkspace && (
          <>
            <div className="hidden md:block w-px h-4 bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger className="hidden md:inline-flex font-mono uppercase tracking-[0.12em] text-xs px-2 py-1 hover:bg-muted transition-colors items-center gap-1.5 max-w-[25vw] truncate">
                <span className="truncate">{activeWorkspace.name}</span>
                <ChevronDown className="size-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-none min-w-[220px]">
                <DropdownMenuLabel className="eyebrow">Workspaces</DropdownMenuLabel>
                {workspaces.map((w, i) => (
                  <DropdownMenuItem key={w._id}>
                    <span className="flex-1 truncate">{w.name}</span>
                    {i < 9 && (
                      <span className="ml-2 eyebrow text-muted-foreground">⌘{i + 1}</span>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/onboarding/new-workspace")}>
                  + New workspace
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Search / command palette */}
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

        {/* Account menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ml-1 md:ml-auto size-8 grid place-items-center hover:bg-muted transition-colors text-xs font-mono border border-border"
            aria-label="Account menu"
          >
            <span aria-hidden="true">{initials}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-none w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm truncate">{displayName}</span>
              {user.email && (
                <span className="text-xs text-muted-foreground font-normal truncate">
                  {user.email}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings/profile")}>
              <UserIcon className="size-3.5 mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/settings/security")}>
              Security
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/settings/integrations")}>
              Integrations
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/settings/referrals")}>
              Referrals
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} className="text-[var(--danger)]">
              <LogOut className="size-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Desktop sidebar — fixed, own scroll, expandable */}
        <SidebarNav
          items={SIDEBAR_ITEMS}
          pathname={pathname ?? ""}
          expanded={sidebarExpanded}
          className="hidden md:flex"
        />

        {/* Mobile sidebar — drawer */}
        {mobileSidebarOpen && (
          <MobileDrawer onClose={() => setMobileSidebarOpen(false)}>
            <SidebarNav
              items={SIDEBAR_ITEMS}
              pathname={pathname ?? ""}
              expanded={true}
              className="flex w-full"
              onNavigate={() => setMobileSidebarOpen(false)}
            />
          </MobileDrawer>
        )}

        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function SidebarNav({
  items,
  pathname,
  expanded,
  className,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  expanded: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  const width = expanded ? "w-56" : "w-14";
  return (
    <nav
      className={cn(
        "border-r border-border flex-col shrink-0 sticky top-12 h-[calc(100vh-3rem)] overflow-y-auto py-3 transition-all duration-150",
        width,
        className,
      )}
    >
      <div className="flex-1 flex flex-col gap-0.5 px-1.5">
        {items.map((item) => (
          <SidebarItem
            key={item.href}
            item={item}
            active={pathname.startsWith(item.href)}
            expanded={expanded}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      <div className="px-1.5 pt-3 mt-3 border-t border-border">
        <SidebarItem
          item={{ href: "/settings", icon: Settings, label: "Settings", key: "," }}
          active={pathname.startsWith("/settings")}
          expanded={expanded}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

function SidebarItem({
  item,
  active,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={expanded ? undefined : `${item.label} (${item.key})`}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 h-10 transition-colors hover:bg-muted text-sm relative",
        expanded ? "px-3" : "px-0 justify-center",
        active
          ? "text-foreground bg-muted/50"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary"
        />
      )}
      <Icon className="size-4 shrink-0" />
      {expanded && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          <span className="font-mono uppercase text-[10px] text-muted-foreground/60 tracking-[0.12em]">
            {item.key}
          </span>
        </>
      )}
    </Link>
  );
}

function MobileDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        aria-label="Close menu"
      />
      <div className="relative w-64 max-w-[85vw] h-full bg-background border-r border-border flex flex-col">
        <div className="h-12 border-b border-border flex items-center justify-between px-3">
          <p className="eyebrow">Menu</p>
          <button
            onClick={onClose}
            className="size-8 grid place-items-center hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
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
