"use client";

/**
 * NotificationSubscriber
 *
 * Sits inside the app shell. Subscribes to the workspace's recent
 * notifications and toasts any that appeared after mount and haven't
 * been read yet.
 *
 * Uses sonner for toasts. Each toast has an "Open" action if the
 * notification carries an actionLink.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { AlertTriangle, Flame, Mail, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";

const ICONS: Record<string, React.ReactNode> = {
  inbound_arrived: <Mail className="size-4 text-primary" />,
  rotting_deal: <AlertTriangle className="size-4 text-[var(--warning)]" />,
  hot_lead: <Flame className="size-4 text-[var(--danger)]" />,
  ai_scored: <Sparkles className="size-4 text-primary" />,
};

export function NotificationSubscriber() {
  const router = useRouter();
  const notifications = useQuery(api.notifications.recent);
  const mountedAt = useRef<number>(Date.now());
  const shownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!notifications) return;
    for (const n of notifications) {
      // Only toast items created after this component mounted, and
      // only ones we haven't already shown, and only unread ones.
      if (n._creationTime < mountedAt.current) continue;
      if (shownIds.current.has(n._id)) continue;
      if (n.readAt) continue;

      shownIds.current.add(n._id);

      toast(n.title, {
        description: n.body,
        icon: ICONS[n.kind] ?? <Sparkles className="size-4 text-primary" />,
        action: n.actionLink
          ? {
              label: "Open",
              onClick: () => router.push(n.actionLink!),
            }
          : undefined,
        duration: 8000,
      });
    }
  }, [notifications, router]);

  return null;
}
