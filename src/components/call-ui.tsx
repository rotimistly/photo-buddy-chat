import { Mic, MicOff, PhoneOff, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CallStatus, IncomingCall } from "@/hooks/use-voice-call";

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "",
  calling: "Calling…",
  ringing: "Ringing…",
  connected: "Connected",
  ended: "Ended",
};

export function CallControls({
  status,
  muted,
  onHangup,
  onToggleMute,
  peerName,
}: {
  status: CallStatus;
  muted: boolean;
  onHangup: () => void;
  onToggleMute: () => void;
  peerName?: string | null;
}) {
  if (status === "idle") return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
      <span
        className={
          status === "connected"
            ? "h-2 w-2 rounded-full bg-green-500"
            : "h-2 w-2 animate-pulse rounded-full bg-primary"
        }
      />
      <span className="font-medium">
        {peerName ? `${peerName} · ` : ""}
        {STATUS_LABEL[status]}
      </span>
      <Button
        size="icon"
        variant="outline"
        onClick={onToggleMute}
        className="h-7 w-7"
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="destructive"
        onClick={onHangup}
        className="h-7 w-7"
        title="End call"
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function IncomingCallDialog({
  incoming,
  onAccept,
  onDecline,
}: {
  incoming: IncomingCall | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (!incoming) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/15">
          <Phone className="h-7 w-7 animate-pulse text-primary" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Incoming voice call</p>
        <p className="mt-1 font-display text-2xl">{incoming.caller_name ?? "Unknown"}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button variant="destructive" onClick={onDecline} className="rounded-full">
            <PhoneOff className="mr-2 h-4 w-4" /> Decline
          </Button>
          <Button onClick={onAccept} className="rounded-full bg-green-600 hover:bg-green-700">
            <Phone className="mr-2 h-4 w-4" /> Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
