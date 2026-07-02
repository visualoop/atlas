"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { Plus, Trash2, Loader2, DollarSign, User, Building2, Calendar, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { NewDealDialog } from "./new-deal-dialog";

export default function PipelinesPage() {
  const pipelines = useQuery(api.pipelines.listPipelines, {});
  const seed = useMutation(api.pipelines.ensureDefaultPipelines);
  const [activePipelineId, setActivePipelineId] = useState<Id<"pipelines"> | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [newDealOpen, setNewDealOpen] = useState(false);

  useEffect(() => {
    if (pipelines && pipelines.length > 0 && !activePipelineId) {
      setActivePipelineId(pipelines[0]._id);
    }
  }, [pipelines, activePipelineId]);

  if (pipelines === undefined) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-16">
        <header className="space-y-2 mb-10">
          <p className="eyebrow">Pipelines</p>
          <h1 className="text-4xl md:text-5xl tracking-tight">
            Every deal <em className="italic font-display">has a home</em>.
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            Atlas pre-seeds three pipelines matched to Blyss: Omnix licenses,
            Studio projects, and Marketplace creators. You can customize the
            stages after seeding.
          </p>
        </header>
        <div className="border border-dashed border-border p-10 text-center space-y-4">
          <p className="font-display italic text-2xl text-muted-foreground">Ready when you are.</p>
          <button
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try {
                const r = await seed({});
                toast.success(`Seeded ${r.seeded} pipelines.`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Seed failed.");
              } finally {
                setSeeding(false);
              }
            }}
            className={cn(
              "inline-flex items-center gap-2 h-10 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              seeding && "opacity-70",
            )}
          >
            {seeding ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Seed 3 default pipelines
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-full px-8 py-8">
        <header className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-1 overflow-x-auto">
            {pipelines.map((p) => (
              <button
                key={p._id}
                onClick={() => setActivePipelineId(p._id)}
                className={cn(
                  "h-9 px-4 text-sm font-mono uppercase tracking-[0.12em] whitespace-nowrap transition-colors",
                  activePipelineId === p._id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setNewDealOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-4 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
          >
            <Plus className="size-3.5" /> New deal
          </button>
        </header>

        {activePipelineId && <KanbanBoard pipelineId={activePipelineId} />}
      </div>

      {activePipelineId && newDealOpen && (
        <NewDealDialog
          pipelineId={activePipelineId}
          onClose={() => setNewDealOpen(false)}
        />
      )}
    </>
  );
}

/* ================================================================== */
/* Kanban board                                                          */
/* ================================================================== */

function KanbanBoard({ pipelineId }: { pipelineId: Id<"pipelines"> }) {
  const view = useQuery(api.pipelines.kanbanView, { pipelineId });
  const moveDeal = useMutation(api.pipelines.moveDeal);
  const [activeDeal, setActiveDeal] = useState<Doc<"deals"> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Local state mirrors server view for optimistic drag. When Convex
  // re-fetches, we snap back to authoritative order.
  const [columns, setColumns] = useState<
    Array<{ stage: Doc<"pipelineStages">; deals: Doc<"deals">[] }>
  >([]);
  useEffect(() => {
    if (view?.columns) setColumns(view.columns);
  }, [view?.columns]);

  const dealsById = useMemo(() => {
    const map = new Map<string, { deal: Doc<"deals">; stageId: Id<"pipelineStages"> }>();
    for (const col of columns) {
      for (const d of col.deals) map.set(d._id, { deal: d, stageId: col.stage._id });
    }
    return map;
  }, [columns]);

  function onDragStart(e: DragStartEvent) {
    const rec = dealsById.get(String(e.active.id));
    if (rec) setActiveDeal(rec.deal);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeRec = dealsById.get(activeId);
    if (!activeRec) return;

    // over target can be a stage (dropped in empty column) or another deal
    let targetStageId: Id<"pipelineStages">;
    let targetIndex: number | undefined;
    if (overId.startsWith("stage-")) {
      targetStageId = overId.replace(/^stage-/, "") as Id<"pipelineStages">;
      targetIndex = undefined;
    } else {
      const overRec = dealsById.get(overId);
      if (!overRec) return;
      targetStageId = overRec.stageId;
      const col = columns.find((c) => c.stage._id === targetStageId);
      targetIndex = col?.deals.findIndex((d) => d._id === overRec.deal._id) ?? 0;
    }

    // Optimistic column update
    setColumns((prev) => {
      const clone = prev.map((c) => ({ ...c, deals: [...c.deals] }));
      const fromCol = clone.find((c) => c.deals.some((d) => d._id === activeId));
      if (!fromCol) return prev;
      const idx = fromCol.deals.findIndex((d) => d._id === activeId);
      const [moved] = fromCol.deals.splice(idx, 1);
      const toCol = clone.find((c) => c.stage._id === targetStageId);
      if (!toCol) return prev;
      const insertAt = targetIndex ?? toCol.deals.length;
      toCol.deals.splice(insertAt, 0, moved);
      return clone;
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveDeal(null);
    if (!over) return;
    const activeId = String(active.id);
    const activeRec = dealsById.get(activeId);
    if (!activeRec) return;

    // Determine final position from columns
    const finalCol = columns.find((c) => c.deals.some((d) => d._id === activeId));
    if (!finalCol) return;
    const finalIdx = finalCol.deals.findIndex((d) => d._id === activeId);
    try {
      await moveDeal({
        id: activeRec.deal._id,
        toStageId: finalCol.stage._id,
        toIndex: finalIdx,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Move failed.");
    }
  }

  if (!view) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "70vh" }}>
        {columns.map((col) => (
          <StageColumn key={col.stage._id} stage={col.stage} deals={col.deals} />
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <div className="w-72 opacity-90">
            <DealCard deal={activeDeal} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ================================================================== */
/* Stage column                                                          */
/* ================================================================== */

function StageColumn({
  stage, deals,
}: { stage: Doc<"pipelineStages">; deals: Doc<"deals">[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage._id}` });

  const totalCents = deals.reduce((sum, d) => sum + Number(d.amountCents), 0);
  const currency = deals[0]?.currency ?? "KES";

  const terminal = stage.isWon ? "won" : stage.isLost ? "lost" : null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 w-72 flex flex-col border border-border bg-[var(--surface)]/40",
        isOver && "ring-1 ring-primary",
      )}
    >
      <div className={cn(
        "px-3 h-11 border-b border-border flex items-center justify-between gap-2",
        terminal === "won" && "text-[var(--success)]",
        terminal === "lost" && "text-muted-foreground",
      )}>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono uppercase tracking-[0.12em] text-xs truncate">{stage.name}</span>
          <span className="font-mono text-xs text-muted-foreground num">{deals.length}</span>
        </div>
        {totalCents > 0 && (
          <span className="text-[11px] font-mono text-muted-foreground num shrink-0">
            {formatCurrency(totalCents, currency)}
          </span>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {deals.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground italic">
            {terminal === "won" ? "Nothing here." : "Drop deals here."}
          </div>
        )}
        {deals.map((deal) => (
          <DraggableDealCard key={deal._id} deal={deal} />
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Deal card                                                             */
/* ================================================================== */

function DraggableDealCard({ deal }: { deal: Doc<"deals"> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal._id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0 : 1,
      }
    : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <DealCard deal={deal} />
    </div>
  );
}

function DealCard({ deal, dragging }: { deal: Doc<"deals">; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "border border-border bg-background p-3 cursor-grab active:cursor-grabbing hover:border-foreground transition-colors",
        dragging && "shadow-xl border-primary",
      )}
    >
      <p className="text-sm font-medium leading-snug line-clamp-2">{deal.name}</p>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-mono num">
          {formatCurrency(Number(deal.amountCents), deal.currency)}
        </span>
        {typeof deal.healthScore === "number" && (
          <span
            className={cn(
              "text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 border",
              deal.healthScore >= 70
                ? "border-[var(--success)] text-[var(--success)]"
                : deal.healthScore >= 40
                  ? "border-[var(--warning)] text-[var(--warning)]"
                  : "border-[var(--danger)] text-[var(--danger)]",
            )}
          >
            {deal.healthScore}
          </span>
        )}
      </div>
      {deal.expectedCloseDate && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Calendar className="size-3" />
          {new Date(deal.expectedCloseDate).toLocaleDateString("en-KE", {
            day: "numeric", month: "short",
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Utility                                                              */
/* ================================================================== */

function formatCurrency(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}
