import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ShieldCheck,
  LogOut,
  Loader2,
  Send,
  Image as ImageIcon,
  Mic,
  Square,
  Users,
  MessageSquare,
  Megaphone,
  Search,
  Phone,
  Hourglass,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { getAdminSeats, registerAdmin } from "@/lib/auth.functions";
import { claimUser, releaseUser } from "@/lib/claim.functions";
import { getSignedMediaUrls } from "@/lib/media.functions";
import { notifyRecipients, notifyAnnouncement } from "@/lib/fcm.functions";
import { ensureFcmSubscribed } from "@/lib/fcm-client";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { CallControls, IncomingCallDialog } from "@/components/call-ui";

export const Route = createFileRoute("/ops-console-9f2a")({
  head: () => ({
    meta: [{ title: "Ops Console" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: OpsConsole,
});

type Session = { userId: string; email: string };
type WaitingUser = { id: string; name: string; four_digit_id: string | null; created_at: string };
type OwnedUser = { id: string; name: string; four_digit_id: string | null; created_at: string };
type Conversation = { id: string; user_id: string; owner_admin_id: string };
type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  media_path: string | null;
  media_kind: string | null;
  created_at: string;
};
type AdminPeer = { id: string; name: string };

function OpsConsole() {
  const [phase, setPhase] = useState<"loading" | "auth" | "denied" | "workspace">("loading");
  const [session, setSession] = useState<Session | null>(null);

  const checkSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setPhase("auth");
      return;
    }
    const uid = data.session.user.id;
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) {
      setPhase("denied");
      return;
    }
    setSession({ userId: uid, email: data.session.user.email ?? "" });
    setPhase("workspace");
    ensureFcmSubscribed("admin").catch(() => {});
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (phase === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-3xl">Access Denied.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your account is not an administrator.
          </p>
          <Button
            className="mt-6"
            onClick={async () => {
              await supabase.auth.signOut();
              setSession(null);
              setPhase("auth");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "auth") return <AdminAuthCard onSignedIn={checkSession} />;

  return <AdminWorkspace session={session!} />;
}

function AdminAuthCard({ onSignedIn }: { onSignedIn: () => void }) {
  const [tab, setTab] = useState<"signin" | "create">("signin");
  const [seats, setSeats] = useState<{ used: number; remaining: number } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAdminSeats()
      .then(setSeats)
      .catch(() => setSeats({ used: 0, remaining: 2 }));
  }, []);

  useEffect(() => {
    if (seats && seats.remaining === 0 && tab === "create") setTab("signin");
  }, [seats, tab]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (tab === "create") {
        if (name.trim().length < 1) throw new Error("Enter your name");
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        await registerAdmin({ data: { name: name.trim(), email: email.trim(), password } });
        toast.success("Admin account created. Signing in…");
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      onSignedIn();
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="font-display text-xl">Ops Console</span>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex rounded-full bg-muted p-1">
            <button
              type="button"
              onClick={() => setTab("signin")}
              className={cn(
                "flex-1 rounded-full px-4 py-2 text-sm font-medium",
                tab === "signin" ? "bg-background shadow" : "text-muted-foreground",
              )}
            >
              Sign in
            </button>
            {seats && seats.remaining > 0 && (
              <button
                type="button"
                onClick={() => setTab("create")}
                className={cn(
                  "flex-1 rounded-full px-4 py-2 text-sm font-medium",
                  tab === "create" ? "bg-background shadow" : "text-muted-foreground",
                )}
              >
                Create admin ({seats.remaining} left)
              </button>
            )}
          </div>
          {seats && seats.remaining === 0 && tab === "signin" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Both administrator seats are taken. New admin accounts cannot be created.
            </p>
          )}
          <form onSubmit={submit} className="mt-4 space-y-3">
            {tab === "create" && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-name">Name</Label>
                <Input
                  id="admin-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={40}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-pw">Password</Label>
              <Input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tab === "create" ? "Create admin" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AdminWorkspace({ session }: { session: Session }) {
  const navigate = useNavigate();
  type Tab = "chats" | "waiting" | "announcements" | "history";
  const [tab, setTab] = useState<Tab>("chats");
  const [waiting, setWaiting] = useState<WaitingUser[]>([]);
  const [users, setUsers] = useState<OwnedUser[]>([]);
  const [convs, setConvs] = useState<Record<string, Conversation>>({});
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ users: 0, waiting: 0, messages: 0 });
  const [adminPeers, setAdminPeers] = useState<AdminPeer[]>([]);

  const voice = useVoiceCall(session.userId);

  const signOut = async () => {
    await voice.hangup();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const loadUsers = useCallback(async () => {
    const [{ data: w }, { data: mine }, { data: cs }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, name, four_digit_id, created_at")
        .is("assigned_admin_id", null)
        .eq("is_admin", false)
        .order("created_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, name, four_digit_id, created_at")
        .eq("assigned_admin_id", session.userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("conversations")
        .select("id, user_id, owner_admin_id")
        .eq("owner_admin_id", session.userId),
    ]);
    setWaiting(w ?? []);
    setUsers(mine ?? []);
    const map: Record<string, Conversation> = {};
    (cs ?? []).forEach((c) => (map[c.user_id] = c));
    setConvs(map);
    const { count: msgCount } = await supabase
      .from("messages")
      .select("*", { head: true, count: "exact" })
      .eq("owner_admin_id", session.userId);
    setStats({ users: (mine ?? []).length, waiting: (w ?? []).length, messages: msgCount ?? 0 });
  }, [session.userId]);

  // Load other admin peers (for admin↔admin calls).
  const loadAdminPeers = useCallback(async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    const ids = (roles ?? []).map((r) => r.user_id as string).filter((id) => id !== session.userId);
    if (ids.length === 0) {
      setAdminPeers([]);
      return;
    }
    const { data: profs } = await supabase.from("profiles").select("id, name").in("id", ids);
    setAdminPeers((profs ?? []) as AdminPeer[]);
  }, [session.userId]);

  useEffect(() => {
    loadUsers();
    loadAdminPeers();
    const chP = supabase
      .channel(`ops-profiles-${session.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () =>
        loadUsers(),
      )
      .subscribe();
    const chC = supabase
      .channel(`ops-convs-${session.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () =>
        loadUsers(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(chP);
      supabase.removeChannel(chC);
    };
  }, [session.userId, loadUsers, loadAdminPeers]);

  const handleClaim = async (userId: string) => {
    try {
      await claimUser({ data: { userId } });
      toast.success("User claimed");
      await loadUsers();
      setActiveUserId(userId);
      setTab("chats");
    } catch (e: any) {
      toast.error(e?.message ?? "Claim failed");
      await loadUsers();
    }
  };

  const handleRelease = async (userId: string) => {
    if (!confirm("Release this user back to the waiting queue?")) return;
    try {
      await releaseUser({ data: { userId } });
      if (activeUserId === userId) setActiveUserId(null);
      toast.success("User released");
      await loadUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Release failed");
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || (u.four_digit_id ?? "").includes(q),
    );
  }, [users, search]);

  const activeConv = activeUserId ? convs[activeUserId] : null;
  const activeUser = activeUserId ? (users.find((u) => u.id === activeUserId) ?? null) : null;

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-72 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm">Ops Console</p>
              <p className="truncate text-[10px] text-muted-foreground">{session.email}</p>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={signOut} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          <NavItem
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chats"
            count={users.length}
            active={tab === "chats"}
            onClick={() => setTab("chats")}
          />
          <NavItem
            icon={<Hourglass className="h-4 w-4" />}
            label="Waiting"
            count={waiting.length}
            active={tab === "waiting"}
            onClick={() => setTab("waiting")}
            highlight={waiting.length > 0}
          />
          <NavItem
            icon={<Megaphone className="h-4 w-4" />}
            label="Announcements"
            active={tab === "announcements"}
            onClick={() => setTab("announcements")}
          />
          <NavItem
            icon={<Phone className="h-4 w-4" />}
            label="Call history"
            active={tab === "history"}
            onClick={() => setTab("history")}
          />
        </nav>
        {adminPeers.length > 0 && (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Admin peers
            </p>
            <ul className="space-y-1">
              {adminPeers.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
                >
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[10px] font-medium">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => voice.call(p.id, null)}
                    disabled={voice.inCall}
                    title={`Call ${p.name}`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          <p>
            <Users className="mr-1 inline h-3 w-3" /> {stats.users} users
          </p>
          <p>
            <MessageSquare className="mr-1 inline h-3 w-3" /> {stats.messages} messages
          </p>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
        <IncomingCallDialog
          incoming={voice.incoming}
          onAccept={voice.accept}
          onDecline={voice.decline}
        />
        {voice.inCall && (
          <div className="border-b border-border bg-card/60 px-4 py-2">
            <div className="mx-auto flex max-w-3xl items-center justify-end">
              <CallControls
                status={voice.status}
                muted={voice.muted}
                onHangup={voice.hangup}
                onToggleMute={voice.toggleMute}
              />
            </div>
          </div>
        )}
        {tab === "waiting" && <WaitingTab waiting={waiting} onClaim={handleClaim} />}
        {tab === "announcements" && <AnnouncementsTab session={session} />}
        {tab === "history" && <CallHistoryTab session={session} />}
        {tab === "chats" && (
          <div className="flex flex-1">
            <div className="flex w-72 flex-col border-r border-border bg-card">
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search my users"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {filteredUsers.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {users.length === 0
                      ? "No claimed users yet. Check the Waiting tab."
                      : "No matches."}
                  </p>
                )}
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setActiveUserId(u.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent",
                      activeUserId === u.id && "bg-accent",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">#{u.four_digit_id}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-col">
              {!activeConv || !activeUser ? (
                <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                  Select a user to open the chat.
                </div>
              ) : (
                <AdminChat
                  session={session}
                  conv={activeConv}
                  user={activeUser}
                  onRelease={() => handleRelease(activeUser.id)}
                  onCall={() => voice.call(activeUser.id, activeConv.id)}
                  canCall={!voice.inCall}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  highlight,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        active ? "bg-accent font-medium" : "text-foreground hover:bg-accent/60",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px]",
            highlight ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function WaitingTab({
  waiting,
  onClaim,
}: {
  waiting: WaitingUser[];
  onClaim: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl">Waiting users</h1>
        <p className="text-sm text-muted-foreground">
          First to claim wins. Once claimed, only you can access that user.
        </p>
        <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
          {waiting.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nobody waiting right now.
            </p>
          )}
          {waiting.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-foreground font-medium">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">
                  #{u.four_digit_id} · registered{" "}
                  {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
                </p>
              </div>
              <Button size="sm" onClick={() => onClaim(u.id)}>
                <UserPlus className="mr-1.5 h-4 w-4" /> Claim
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnnouncementsTab({ session }: { session: Session }) {
  const [items, setItems] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("announcements")
      .select("id, body, created_at")
      .eq("owner_admin_id", session.userId)
      .order("created_at", { ascending: false });
    setItems(data ?? []);
  }, [session.userId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("announcements")
      .insert({ owner_admin_id: session.userId, body });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    await load();
    notifyAnnouncement({ data: { preview: body.slice(0, 120) } }).catch(() => {});
    toast.success("Announcement posted");
  };

  const remove = async (id: string) => {
    await supabase.from("announcements").delete().eq("id", id);
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl">Announcements</h1>
        <p className="text-sm text-muted-foreground">Only visible to your assigned users.</p>
        <form onSubmit={post} className="mt-5 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Post an update to your users…"
            maxLength={2000}
          />
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Post announcement
          </Button>
        </form>
        <div className="mt-8 space-y-3">
          {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap break-words text-sm">{a.body}</p>
                <Button size="icon" variant="ghost" onClick={() => remove(a.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  status: string;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
};

function CallHistoryTab({ session }: { session: Session }) {
  const [items, setItems] = useState<CallRow[]>([]);
  useEffect(() => {
    supabase
      .from("call_history")
      .select("id, caller_id, callee_id, status, duration_seconds, started_at, ended_at")
      .or(`caller_id.eq.${session.userId},callee_id.eq.${session.userId}`)
      .order("started_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setItems((data ?? []) as CallRow[]));
  }, [session.userId]);
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl">Call history</h1>
        <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
          {items.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">No calls yet.</p>
          )}
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-4 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 capitalize">{c.status}</span>
              <span className="text-muted-foreground">{c.duration_seconds ?? 0}s</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(c.started_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminChat({
  session,
  conv,
  user,
  onRelease,
  onCall,
  canCall,
}: {
  session: Session;
  conv: Conversation;
  user: OwnedUser;
  onRelease: () => void;
  onCall: () => void;
  canCall: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
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
      } catch {}
    }
  }, [conv.id]);

  useEffect(() => {
    loadMessages();
    const ch = supabase
      .channel(`aconv-${conv.id}`)
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
  }, [conv.id, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      conversation_id: conv.id,
      owner_admin_id: session.userId,
      sender_id: session.userId,
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
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File must be under 20MB");
      return;
    }
    const ext = file.name.split(".").pop() || (kind === "voice" ? "webm" : "bin");
    const path = `${session.userId}/${conv.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
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
      owner_admin_id: session.userId,
      sender_id: session.userId,
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
        await uploadFile(
          new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }),
          "voice",
        );
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

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-accent font-medium">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">#{user.four_digit_id}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onCall} disabled={!canCall}>
          <Phone className="mr-1.5 h-4 w-4" /> Call
        </Button>
        <Button size="sm" variant="ghost" onClick={onRelease}>
          Release
        </Button>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {messages.map((m) => (
            <MsgBubble key={m.id} m={m} mine={m.sender_id === session.userId} signed={signed} />
          ))}
          {messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No messages yet. Say hello.
            </p>
          )}
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
            >
              <Mic className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="destructive" size="icon" onClick={stopRec}>
              <Square className="h-4 w-4" />
            </Button>
          )}
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply…"
            disabled={sending || recording}
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </>
  );
}

function MsgBubble({
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
