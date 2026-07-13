// Minimal WebRTC voice-call helper using Supabase Realtime broadcast for signaling.
// STUN-only (no TURN); works on most home networks.
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type CallRole = "caller" | "callee";
export type CallStatus = "idle" | "ringing" | "connecting" | "connected" | "ended";

export interface CallSession {
  pc: RTCPeerConnection;
  channel: RealtimeChannel;
  localStream: MediaStream | null;
  remoteStream: MediaStream;
  end: () => Promise<void>;
}

export async function startCall(opts: {
  conversationId: string;
  selfId: string;
  peerId: string;
  role: CallRole;
  onRemote: (stream: MediaStream) => void;
  onStatus: (s: CallStatus) => void;
}): Promise<CallSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const remoteStream = new MediaStream();
  opts.onRemote(remoteStream);

  pc.ontrack = (ev) => ev.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") opts.onStatus("connected");
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") opts.onStatus("ended");
  };

  const channel = supabase.channel(`call-${opts.conversationId}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      channel.send({
        type: "broadcast",
        event: "ice",
        payload: { from: opts.selfId, to: opts.peerId, candidate: ev.candidate.toJSON() },
      });
    }
  };

  channel.on("broadcast", { event: "offer" }, async ({ payload }) => {
    if (payload.to !== opts.selfId) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    channel.send({
      type: "broadcast",
      event: "answer",
      payload: { from: opts.selfId, to: opts.peerId, sdp: answer },
    });
  });
  channel.on("broadcast", { event: "answer" }, async ({ payload }) => {
    if (payload.to !== opts.selfId) return;
    if (!pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    }
  });
  channel.on("broadcast", { event: "ice" }, async ({ payload }) => {
    if (payload.to !== opts.selfId) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch {}
  });
  channel.on("broadcast", { event: "hangup" }, () => {
    opts.onStatus("ended");
  });

  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });

  const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  if (opts.role === "caller") {
    opts.onStatus("ringing");
    channel.send({
      type: "broadcast",
      event: "ring",
      payload: { from: opts.selfId, to: opts.peerId },
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    channel.send({
      type: "broadcast",
      event: "offer",
      payload: { from: opts.selfId, to: opts.peerId, sdp: offer },
    });
  } else {
    opts.onStatus("connecting");
  }

  const end = async () => {
    try {
      channel.send({
        type: "broadcast",
        event: "hangup",
        payload: { from: opts.selfId, to: opts.peerId },
      });
    } catch {}
    localStream.getTracks().forEach((t) => t.stop());
    pc.close();
    await supabase.removeChannel(channel);
    opts.onStatus("ended");
  };

  return { pc, channel, localStream, remoteStream, end };
}

export async function listenForIncomingCall(opts: {
  conversationId: string;
  selfId: string;
  onRing: (fromId: string) => void;
}): Promise<() => void> {
  const channel = supabase.channel(`call-${opts.conversationId}`, {
    config: { broadcast: { self: false } },
  });
  channel.on("broadcast", { event: "ring" }, ({ payload }) => {
    if (payload.to === opts.selfId) opts.onRing(payload.from);
  });
  await new Promise<void>((resolve) => channel.subscribe((s) => s === "SUBSCRIBED" && resolve()));
  return () => {
    supabase.removeChannel(channel);
  };
}
