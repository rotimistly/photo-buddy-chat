import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MessageCircleHeart, Plus, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/chats")({
  component: ChatsLayout,
});

type Conversation = {
  id: string;
  subject: string;
  updated_at: string;
  user_id: string;
  status: string;
};

function ChatsLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isSupport, setIsSupport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setIsSupport(!!data?.some(r => r.role === "admin" || r.role === "support"));
    });
  }, [user.id]);

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, subject, updated_at, user_id, status")
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else setConversations(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadConversations();
    const channel = supabase
      .channel("conv-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, loadConversations)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createConversation = async () => {
    setCreating(true);
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, subject: "New conversation" })
      .select()
      .single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    navigate({ to: "/chats/$threadId", params: { threadId: data.id } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-80 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between px-5 py-5">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-brand-foreground">
              <MessageCircleHeart className="h-4 w-4" />
            </div>
            <span className="font-display text-lg">Lumen</span>
            {isSupport && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                <ShieldCheck className="h-3 w-3" /> Support
              </span>
            )}
          </Link>
          <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {!isSupport && (
          <div className="px-4 pb-3">
            <Button onClick={createConversation} disabled={creating} className="w-full rounded-full">
              <Plus className="mr-1 h-4 w-4" /> New conversation
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {isSupport ? "No conversations yet." : "Start a conversation to get help."}
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map(c => (
                <li key={c.id}>
                  <Link
                    to="/chats/$threadId"
                    params={{ threadId: c.id }}
                    className={cn(
                      "block rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-accent",
                      activeId === c.id && "bg-accent",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.subject}</span>
                      <span className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                        c.status === "open" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}>{c.status}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Signed in as <span className="text-foreground">{user.email}</span>
        </div>
      </aside>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
