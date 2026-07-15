import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Package, Loader2, CheckCircle2, Circle, PauseCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { SHIPMENT_STEPS, type ShipmentStep } from "@/lib/tracking.functions";

export const Route = createFileRoute("/tracking")({
  head: () => ({
    meta: [
      { title: "Package tracking" },
      { name: "description", content: "Track the packages sent to you by your support admin." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackingPage,
});

type Shipment = {
  id: string;
  tracking_number: string;
  description: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  origin: string | null;
  destination: string | null;
  courier: string | null;
  weight: string | null;
  estimated_delivery: string | null;
  status: ShipmentStep | "paused";
  created_at: string;
};

type Event = {
  id: string;
  shipment_id: string;
  step: ShipmentStep | "paused";
  note: string | null;
  location: string | null;
  created_at: string;
};

const STEP_LABELS: Record<string, string> = {
  order_created: "Order created",
  package_received: "Package received",
  processing: "Processing",
  dispatched: "Dispatched",
  export_customs: "Export customs cleared",
  international_transit: "International transit",
  import_customs: "Import customs cleared",
  local_distribution: "Local distribution",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  paused: "Paused",
};

function TrackingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        navigate({ to: "/" });
        return;
      }
      setUserId(s.session.user.id);
      const { data } = await supabase
        .from("shipments")
        .select(
          "id, tracking_number, description, sender_name, receiver_name, origin, destination, courier, weight, estimated_delivery, status, created_at",
        )
        .eq("customer_id", s.session.user.id)
        .order("created_at", { ascending: false });
      const list = (data ?? []) as Shipment[];
      setShipments(list);
      if (list.length) setSelectedId(list[0].id);
      setLoading(false);
    })();
  }, [navigate]);

  // Realtime for shipment status changes on my rows
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`ships-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments", filter: `customer_id=eq.${userId}` },
        (payload) => {
          setShipments((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((s) => s.id !== (payload.old as any).id);
            const next = payload.new as Shipment;
            const exists = prev.some((s) => s.id === next.id);
            return exists ? prev.map((s) => (s.id === next.id ? next : s)) : [next, ...prev];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const loadEvents = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("shipment_events")
      .select("id, shipment_id, step, note, location, created_at")
      .eq("shipment_id", id)
      .order("created_at", { ascending: true });
    setEvents((data ?? []) as Event[]);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadEvents(selectedId);
    const ch = supabase
      .channel(`ship-events-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "shipment_events",
          filter: `shipment_id=eq.${selectedId}`,
        },
        () => loadEvents(selectedId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [selectedId, loadEvents]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selected = shipments.find((s) => s.id === selectedId) ?? null;
  const currentIdx = selected
    ? SHIPMENT_STEPS.indexOf(selected.status as ShipmentStep)
    : -1;
  const paused = selected?.status === "paused";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link to="/chat" className="rounded-full p-2 hover:bg-accent" aria-label="Back to chat">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-lg">Package tracking</h1>
            <p className="text-xs text-muted-foreground">Live updates from your admin</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {shipments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <Package className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No shipments yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When your admin creates a tracking code for you, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            <aside className="space-y-2">
              {shipments.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "w-full rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary",
                    s.id === selectedId && "border-primary ring-1 ring-primary",
                  )}
                >
                  <p className="font-mono text-sm">{s.tracking_number}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {STEP_LABELS[s.status] ?? s.status}
                  </p>
                </button>
              ))}
            </aside>

            {selected && (
              <section className="space-y-6">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-lg">{selected.tracking_number}</p>
                      {selected.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        paused
                          ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                          : selected.status === "delivered"
                            ? "bg-green-500/15 text-green-700 dark:text-green-400"
                            : "bg-primary/15 text-primary",
                      )}
                    >
                      {STEP_LABELS[selected.status]}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    {selected.sender_name && <Info label="From" value={selected.sender_name} />}
                    {selected.receiver_name && <Info label="To" value={selected.receiver_name} />}
                    {selected.origin && <Info label="Origin" value={selected.origin} />}
                    {selected.destination && <Info label="Destination" value={selected.destination} />}
                    {selected.courier && <Info label="Courier" value={selected.courier} />}
                    {selected.weight && <Info label="Weight" value={selected.weight} />}
                    {selected.estimated_delivery && (
                      <Info label="ETA" value={selected.estimated_delivery} />
                    )}
                  </dl>
                </div>

                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="font-medium">Progress</h2>
                  <ol className="mt-4 space-y-3">
                    {SHIPMENT_STEPS.map((step, i) => {
                      const done = !paused && i < currentIdx;
                      const active = !paused && i === currentIdx;
                      return (
                        <li key={step} className="flex items-start gap-3">
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                          ) : active ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 animate-pulse text-primary" />
                          ) : (
                            <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                          )}
                          <span
                            className={cn(
                              "text-sm",
                              active && "font-medium",
                              !done && !active && "text-muted-foreground",
                            )}
                          >
                            {STEP_LABELS[step]}
                          </span>
                        </li>
                      );
                    })}
                    {paused && (
                      <li className="flex items-start gap-3 text-yellow-700 dark:text-yellow-400">
                        <PauseCircle className="h-5 w-5 shrink-0" />
                        <span className="text-sm font-medium">Shipment currently paused</span>
                      </li>
                    )}
                  </ol>
                </div>

                {events.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h2 className="font-medium">Update history</h2>
                    <ul className="mt-3 space-y-3">
                      {[...events].reverse().map((e) => (
                        <li key={e.id} className="border-l-2 border-border pl-3">
                          <p className="text-sm font-medium">{STEP_LABELS[e.step] ?? e.step}</p>
                          {e.note && <p className="mt-0.5 text-sm text-muted-foreground">{e.note}</p>}
                          {e.location && (
                            <p className="mt-0.5 text-xs text-muted-foreground">📍 {e.location}</p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
