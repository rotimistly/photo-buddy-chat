import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant } from "livekit-client";

export type CallConn = {
  room: Room;
  disconnect: () => Promise<void>;
  toggleMic: () => Promise<boolean>;
  isMicEnabled: () => boolean;
};

export async function connectLivekitCall(opts: {
  url: string;
  token: string;
  onRemoteAudio: (el: HTMLAudioElement) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}): Promise<CallConn> {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const attachedEls = new Map<string, HTMLAudioElement>();

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      attachedEls.set(track.sid ?? Math.random().toString(), el);
      opts.onRemoteAudio(el);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
  });
  room.on(RoomEvent.ParticipantDisconnected, (_p: RemoteParticipant) => {
    // If the only remote leaves, tear down.
    if (room.numParticipants <= 1) void disconnect();
  });
  room.on(RoomEvent.Disconnected, () => opts.onDisconnected());
  room.on(RoomEvent.Connected, () => opts.onConnected());

  await room.connect(opts.url, opts.token);
  // Publish mic (browser prompts for permission if not granted yet).
  await room.localParticipant.setMicrophoneEnabled(true);

  async function disconnect() {
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch { void 0; }
    attachedEls.forEach((el) => el.remove());
    attachedEls.clear();
    await room.disconnect();
  }

  return {
    room,
    disconnect,
    toggleMic: async () => {
      const next = !room.localParticipant.isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      return next;
    },
    isMicEnabled: () => room.localParticipant.isMicrophoneEnabled,
  };
}
