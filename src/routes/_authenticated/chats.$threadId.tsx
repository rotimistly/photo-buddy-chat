import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Image as ImageIcon, Send, Share2, Check, X, Loader2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/chats/$threadId")({
  component: ChatView,
});

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
};

type Conversation = {
  id: string;
  subject: string;
  user_id: string;
  share_token: string;
  status: string;
};

type Profile = { id: string; display_name: string | null; email: string | null; avatar_url: string | null };

function ChatView() {
  const { threadId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: c, error } = await supabase.from("conversations").select("*").eq("id", threadId).maybeSingle();
      if (!active) return;
      if (error || !c) { toast.error("Conversation not found"); navigate({ to: "/chats" }); return; }
      setConv(c);
      setSubjectDraft(c.subject);
    })();
    return () => { active = false; };
  }, [threadId, navigate]);

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", threadId)
      .order("created_at", { ascending: true });
    if (error) { toast.error(error.message); return; }
    setMessages(data ?? []);
    const senderIds = Array.from(new Set((data ?? []).map(m => m.sender_id)));
    if (senderIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name, email, avatar_url").in("id", senderIds);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach(p => { map[p.id] = p; });
      setProfiles(map);
    }
    // Sign image URLs
    const withImg = (data ?? []).filter(m => m.image_url);
    if (withImg.length) {
      const paths = withImg.map(m => m.image_url!);
      const { data: signed } = await supabase.storage.from("chat-photos").createSignedUrls(paths, 3600);
      const urlMap: Record<string, string> = {};
      signed?.forEach((s, i) => { if (s.signedUrl) urlMap[paths[i]] = s.signedUrl; });
      setImageUrls(urlMap);
    }
  };

  useEffect(() => {
    loadMessages();
    const channel = supabase
      .channel(`msg-${threadId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${threadId}` },
        () => loadMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, [threadId]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      conversation_id: threadId, sender_id: user.id, content: body,
    });
    setSending(false);
    if (error) { toast.error(error.message); setText(body); }
    inputRef.current?.focus();
  };

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("Image must be under 10MB"); return; }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${threadId}/${Date.now()}.${ext}`;
    setSending(true);
    const { error: upErr } = await supabase.storage.from("chat-photos").upload(path, file, { contentType: file.type });
    if (upErr) { toast.error(upErr.message); setSending(false); return; }
    const { error } = await supabase.from("messages").insert({
      conversation_id: threadId, sender_id: user.id, image_url: path,
    });
    setSending(false);
    if (error) toast.error(error.message);
  };

  const copyShare = async () => {
    if (!conv) return;
    const url = `${window.location.origin}/share/${conv.share_token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Share link copied to clipboard");
  };

  const saveSubject = async () => {
    if (!conv || !subjectDraft.trim()) return;
    const { error } = await supabase.from("conversations").update({ subject: subjectDraft.trim() }).eq("id", conv.id);
    if (error) toast.error(error.message);
    else { setConv({ ...conv, subject: subjectDraft.trim() }); setEditingSubject(false); }
  };

  const toggleStatus = async () => {
    if (!conv) return;
    const next = conv.status === "open" ? "closed" : "open";
    const { error } = await supabase.from("conversations").update({ status: next }).eq("id", conv.id);
    if (error) toast.error(error.message);
    else setConv({ ...conv, status: next });
  };

  if (!conv) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => navigate({ to: "/chats" })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {editingSubject ? (
            <div className="flex items-center gap-2">
              <Input value={subjectDraft} onChange={e => setSubjectDraft(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && saveSubject()} />
              <Button size="icon" variant="ghost" onClick={saveSubject}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditingSubject(false); setSubjectDraft(conv.subject); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <button className="truncate text-left font-display text-xl" onClick={() => setEditingSubject(true)}>
              {conv.subject}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {conv.status === "open" ? "Open conversation" : "Closed"} · tap title to rename
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={toggleStatus}>
          {conv.status === "open" ? "Close" : "Reopen"}
        </Button>
        <Button variant="outline" size="sm" onClick={copyShare}>
          <Share2 className="mr-1.5 h-4 w-4" /> Share
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Say hello — our team will jump in shortly.</p>
          )}
          {messages.map(m => {
            const mine = m.sender_id === user.id;
            const profile = profiles[m.sender_id];
            return (
              <div key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-medium",
                  mine ? "bg-bubble-user text-bubble-user-foreground" : "bg-accent text-accent-foreground")}>
                  {(profile?.display_name || profile?.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className={cn("flex max-w-[75%] flex-col", mine && "items-end")}>
                  <div className={cn("rounded-2xl px-4 py-2.5 text-sm",
                    mine ? "bg-bubble-user text-bubble-user-foreground rounded-br-sm"
                         : "bg-bubble-support text-bubble-support-foreground rounded-bl-sm")}>
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    {m.image_url && imageUrls[m.image_url] && (
                      <a href={imageUrls[m.image_url]} target="_blank" rel="noreferrer">
                        <img src={imageUrls[m.image_url]} alt="attachment" className={cn("mt-1 max-h-80 rounded-lg", m.content && "mt-2")} />
                      </a>
                    )}
                  </div>
                  <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                    {profile?.display_name || profile?.email || "Unknown"} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={send} className="border-t border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => fileRef.current?.click()} disabled={sending} title="Attach photo">
            <ImageIcon className="h-4 w-4" />
          </Button>
          <Input
            ref={inputRef}
            placeholder="Write a message…"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={sending}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </>
  );
}
