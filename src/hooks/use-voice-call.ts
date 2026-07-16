import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { connectLivekitCall, type CallConn } from "@/lib/livekit-client";
import { startLivekitCall, acceptLivekitCall, endLivekitCall } from "@/lib/livekit.functions";

export type CallStatus = "idle" | "calling" | "ringing" | "connected" | "ended";

export type IncomingCall = {
  room_id: string;
  caller_id: string;
  caller_name: string | null;
};

/**
 * One-to-one voice call manager backed by LiveKit Cloud with signaling via
 * a `call_history` row in Supabase. `selfId` is required to filter incoming
 * rings. Cleans up the LiveKit room, mic track, and realtime channel when
 * the component unmounts.
 */
export function useVoiceCall(selfId: string | null) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [muted, setMuted] = useState(false);
  const connRef = useRef<CallConn | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const cleanup = useCallback(async (finalStatus: "ended" | "declined" | "missed" = "ended") => {
    const conn = connRef.current;
    connRef.current = null;
    if (conn) await conn.disconnect().catch(() => {});
    if (audioContainerRef.current) audioContainerRef.current.innerHTML = "";
    const rid = roomIdRef.current;
    roomIdRef.current = null;
    const duration = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : 0;
    startedAtRef.current = null;
    setMuted(false);
    setStatus("ended");
    if (rid) {
      try {
        await endLivekitCall({
          data: { room_id: rid, status: finalStatus, duration_seconds: duration },
        });
      } catch {
        void 0;
      }
    }
    // reset to idle shortly so UI clears
    setTimeout(() => setStatus((s) => (s === "ended" ? "idle" : s)), 800);
  }, []);

  // Listen for incoming calls on call_history INSERT where callee_id=self.
  useEffect(() => {
    if (!selfId) return;
    const ch = supabase
      .channel(`ring-${selfId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_history",
          filter: `callee_id=eq.${selfId}`,
        },
        async (payload) => {
          const row = payload.new as { id: string; caller_id: string; status: string };
          if (row.status !== "ringing") return;
          if (connRef.current) return; // already on a call
          const { data: p } = await supabase
            .from("profiles")
            .select("name")
            .eq("id", row.caller_id)
            .maybeSingle();
          setIncoming({ room_id: row.id, caller_id: row.caller_id, caller_name: p?.name ?? null });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_history",
          filter: `callee_id=eq.${selfId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (
            (row.status === "ended" || row.status === "declined") &&
            incoming?.room_id === row.id
          ) {
            setIncoming(null);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

  // Caller: also watch our own outgoing row for callee accepting/declining.
  const watchOutgoing = useCallback(
    (roomId: string) => {
      const ch = supabase
        .channel(`outgoing-${roomId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "call_history", filter: `id=eq.${roomId}` },
          (payload) => {
            const row = payload.new as { status: string };
            if (row.status === "connected") {
              setStatus("connected");
              if (!startedAtRef.current) startedAtRef.current = Date.now();
            }
            if (row.status === "declined" || row.status === "ended" || row.status === "missed") {
              void cleanup(row.status === "declined" ? "declined" : "ended");
              supabase.removeChannel(ch);
            }
          },
        )
        .subscribe();
      return () => {
        supabase.removeChannel(ch);
      };
    },
    [cleanup],
  );

  const call = useCallback(
    async (peerId: string, conversationId?: string | null) => {
      if (connRef.current) return;
      setStatus("calling");
      try {
        const r = await startLivekitCall({
          data: { peer_id: peerId, conversation_id: conversationId ?? null },
        });
        roomIdRef.current = r.room_id;
        const unwatch = watchOutgoing(r.room_id);
        const conn = await connectLivekitCall({
          url: r.url,
          token: r.token,
          onRemoteAudio: (el) => {
            if (audioContainerRef.current) audioContainerRef.current.appendChild(el);
          },
          onConnected: () => {
            // We're in the room, but wait for callee "connected" via row update.
          },
          onDisconnected: () => {
            unwatch();
            void cleanup("ended");
          },
        });
        connRef.current = conn;
        setStatus((s) => (s === "calling" ? "ringing" : s));
      } catch (e: unknown) {
        toast.error((e instanceof Error ? e.message : null) ?? "Could not start call");
        await cleanup("ended");
      }
    },
    [cleanup, watchOutgoing],
  );

  const accept = useCallback(async () => {
    if (!incoming) return;
    const rid = incoming.room_id;
    setIncoming(null);
    setStatus("connected");
    try {
      const r = await acceptLivekitCall({ data: { room_id: rid } });
      roomIdRef.current = rid;
      startedAtRef.current = Date.now();
      const conn = await connectLivekitCall({
        url: r.url,
        token: r.token,
        onRemoteAudio: (el) => {
          if (audioContainerRef.current) audioContainerRef.current.appendChild(el);
        },
        onConnected: () => setStatus("connected"),
        onDisconnected: () => void cleanup("ended"),
      });
      connRef.current = conn;
    } catch (e: unknown) {
      toast.error((e instanceof Error ? e.message : null) ?? "Could not answer");
      await cleanup("ended");
    }
  }, [incoming, cleanup]);

  const decline = useCallback(async () => {
    if (!incoming) return;
    const rid = incoming.room_id;
    setIncoming(null);
    try {
      await endLivekitCall({ data: { room_id: rid, status: "declined", duration_seconds: 0 } });
    } catch {
      void 0;
    }
  }, [incoming]);

  const hangup = useCallback(async () => {
    await cleanup("ended");
  }, [cleanup]);

  const toggleMute = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    const enabled = await conn.toggleMic();
    setMuted(!enabled);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const conn = connRef.current;
      connRef.current = null;
      if (conn) void conn.disconnect().catch(() => {});
    };
  }, []);

  return {
    status,
    incoming,
    muted,
    call,
    accept,
    decline,
    hangup,
    toggleMute,
    audioContainerRef,
    inCall: status === "calling" || status === "ringing" || status === "connected",
  };
}
