import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  LogOut,
  Send,
  Image as ImageIcon,
  Mic,
  Square,
  Loader2,
  Hourglass,
  Phone,
  Megaphone,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { getSignedMediaUrls } from "@/lib/media.functions";
import { notifyRecipients } from "@/lib/fcm.functions";
import { ensureFcmSubscribed } from "@/lib/fcm-client";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { CallControls, IncomingCallDialog } from "@/components/call-ui";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [{ title: "Your support chat" }, { name: "robots", content: "noindex" }],
  }),
  component: ChatPage,
});

type Profile = {
  id: string;
  name: string;
  status: string;
  is_admin: boolean;
  assigned_admin_id: string | null;
};
type Conversation = { id: string; user_id: string; owner_admin_id: string };
type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  media_path: string | null;
  media_kind: string | null;
  created_at: string;
};
type Announcement = { id: string; body: string; created_at: string };

function ChatPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  const voice = useVoiceCall(userId);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        navigate({ to: "/" });
        return;
      }
      const uid = s.session.user.id;
      setUserId(uid);
      const { data: p } = await supabase
        .from("profiles")
        .select("id, name, status, is_admin, assigned_admin_id")
        .eq("id", uid)
        .maybeSingle();
      if (!p) {
        toast.error("Profile not found");
        await supabase.auth.signOut();
        navigate({ to: "/" });
        return;
      }
      if (p.is_admin) {
        navigate({ to: "/ops-console-9f2a" });
        return;
      }
      setProfile(p);
      if (p.assigned_admin_id) {
        const { data: a } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", p.assigned_admin_id)
          .maybeSingle();
        setAdminName(a?.name ?? null);
        const { data: c } = await supabase
          .from("conversations")
          .select("id, user_id, owner_admin_id")
          .eq("user_id", uid)
          .maybeSingle();
        setConv(c ?? null);
      }
      setLoading(false);
      ensureFcmSubscribed("user").catch(() => {});
    })();
  }, [navigate]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`prof-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          const p = payload.new as Profile;
          setProfile(p);
          if (p.assigned_admin_id) window.location.reload();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const loadMessages = useCallback(async () => {
    if (!conv) return;
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, content, media_path, media_kind, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });
    setMessages(data ?? []);
    const paths = (data ?? []).filter((m) => m.media_path).map((m) => m.media_path!);
    if (paths.length) {
      try {
        const { urls } = await getSignedMediaUrls({ data: { paths } });
        setSigned(urls);
      } catch {
        void 0;
      }
    }
  }, [conv]);

  useEffect(() => {
    if (!conv) return;
    loadMessages();
    const ch = supabase
      .channel(`msg-${conv.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conv.id}`,
        },
        () => loadMessages(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conv, loadMessages]);

  useEffect(() => {
    if (!profile?.assigned_admin_id) return;
    const ownerId = profile.assigned_admin_id;
    const load = async () => {
      const { data } = await supabase
        .from("announcements")
        .select("id, body, created_at")
        .eq("owner_admin_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(10);
      setAnnouncements(data ?? []);
    };
    load();
    const ch = supabase
      .channel(`ann-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `owner_admin_id=eq.${ownerId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.assigned_admin_id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const signOut = async () => {
    await voice.hangup();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !conv || !userId || sending) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      conversation_id: conv.id,
      owner_admin_id: conv.owner_admin_id,
      sender_id: userId,
      content: body,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      setText(body);
      return;
    }
    notifyRecipients({
      data: { conversationId: conv.id, kind: "message", preview: body.slice(0, 120) },
    }).catch(() => {});
  };

  const uploadFile = async (file: File, kind: "image" | "voice" | "file") => {
    if (!conv || !userId) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File must be under 20MB");
      return;
    }
    const ext = file.name.split(".").pop() || (kind === "voice" ? "webm" : "bin");
    const path = `${conv.owner_admin_id}/${conv.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    setSending(true);
    const { error: upErr } = await supabase.storage
      .from("chat-photos")
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      toast.error(upErr.message);
      setSending(false);
      return;
    }
    const { error } = await supabase.from("messages").insert({
      conversation_id: conv.id,
      owner_admin_id: conv.owner_admin_id,
      sender_id: userId,
      media_path: path,
      media_kind: kind,
    });
    setSending(false);
    if (error) toast.error(error.message);
    else
      notifyRecipients({
        data: {
          conversationId: conv.id,
          kind: "message",
          preview: kind === "image" ? "📷 Photo" : kind === "voice" ? "🎤 Voice note" : "📎 File",
        },
      }).catch(() => {});
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const f = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        await uploadFile(f, "voice");
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
    }
  };
  const stopRec = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  };

  const beginCall = async () => {
    if (!conv || !userId) return;
    await voice.call(conv.owner_admin_id, conv.id);
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile?.assigned_admin_id) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar name={profile?.name ?? ""} onSignOut={signOut} />
        <div className="mx-auto max-w-md px-6 pt-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground">
            <Hourglass className="h-6 w-6 animate-pulse" />
          </div>
          <h1 className="mt-6 font-display text-3xl">You're in the queue</h1>
          <p className="mt-3 text-muted-foreground">
            Your account has been created successfully. Waiting to be assigned to a support
            administrator. You'll be connected shortly.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Waiting
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        name={profile.name}
        subtitle={adminName ? `Chatting with ${adminName}` : "Assigned"}
        onSignOut={signOut}
        right={
          voice.inCall ? (
            <CallControls
              status={voice.status}
              muted={voice.muted}
              onHangup={voice.hangup}
              onToggleMute={voice.toggleMute}
              peerName={adminName}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={beginCall}>
              <Phone className="mr-1.5 h-4 w-4" /> Call
            </Button>
          )
        }
      />
      <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
      <IncomingCallDialog
        incoming={voice.incoming}
        onAccept={voice.accept}
        onDecline={voice.decline}
      />

      {announcements[0] && (
        <div className="border-b border-border bg-accent/40 px-4 py-2 text-sm">
          <div className="mx-auto flex max-w-2xl items-start gap-2">
            <Megaphone className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">{announcements[0].body}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(announcements[0].created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Say hello — your administrator will reply here.
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} mine={m.sender_id === userId} signed={signed} />
          ))}
        </div>
      </div>

      <form onSubmit={send} className="border-t border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx,.txt,.zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f, f.type.startsWith("image/") ? "image" : "file");
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          {!recording ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={startRec}
              disabled={sending}
              title="Record voice"
            >
              <Mic className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={stopRec}
              title="Stop recording"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          <Input
            placeholder="Write a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={sending || recording}
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function TopBar({
  name,
  subtitle,
  right,
  onSignOut,
}: {
  name: string;
  subtitle?: string;
  right?: React.ReactNode;
  onSignOut: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg">{name}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
      <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </header>
  );
}

function MessageBubble({
  m,
  mine,
  signed,
}: {
  m: Message;
  mine: boolean;
  signed: Record<string, string>;
}) {
  const url = m.media_path ? signed[m.media_path] : null;
  return (
    <div className={cn("flex", mine && "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
          mine
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
        {m.media_kind === "image" && url && (
          <a href={url} target="_blank" rel="noreferrer">
            <img
              src={url}
              alt="attachment"
              className={cn("max-h-80 rounded-lg", m.content && "mt-2")}
            />
          </a>
        )}
        {m.media_kind === "voice" && url && <audio src={url} controls className="mt-1 w-56" />}
        {m.media_kind === "file" && url && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 block underline">
            Download file
          </a>
        )}
        <p
          className={cn(
            "mt-1 text-[10px]",
            mine ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}
