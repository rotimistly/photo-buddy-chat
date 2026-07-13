import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getSharedConversation } from "@/lib/share.functions";
import { MessageCircleHeart } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/share/$token")({
  loader: async ({ params }) => {
    const data = await getSharedConversation({ data: { token: params.token } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.subject} — Lumen Support` : "Shared conversation" },
      { name: "description", content: "A shared support conversation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <h1 className="font-display text-2xl">Couldn't load conversation</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <h1 className="font-display text-2xl">Link expired or invalid</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ask the sender for a new share link.</p>
      </div>
    </div>
  ),
  component: SharedView,
});

function SharedView() {
  const data = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-brand-foreground">
              <MessageCircleHeart className="h-4 w-4" />
            </div>
            <span className="font-display text-lg">Lumen</span>
          </Link>
          <span className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">Read-only</span>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Shared conversation</p>
        <h1 className="mt-1 font-display text-3xl">{data.subject}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Started {format(new Date(data.created_at), "PPP")} · {data.status}
        </p>

        <div className="mt-8 space-y-4">
          {data.messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
          {data.messages.map((m, i) => {
            const isOwner = m.sender_id === data.owner_id;
            return (
              <div key={m.id} className={cn("flex gap-3", !isOwner && "flex-row-reverse")}>
                <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-medium",
                  !isOwner ? "bg-bubble-user text-bubble-user-foreground" : "bg-accent text-accent-foreground")}>
                  {m.sender.charAt(0).toUpperCase()}
                </div>
                <div className={cn("flex max-w-[75%] flex-col", !isOwner && "items-end")}>
                  <div className={cn("rounded-2xl px-4 py-2.5 text-sm",
                    !isOwner ? "bg-bubble-user text-bubble-user-foreground rounded-br-sm"
                             : "bg-bubble-support text-bubble-support-foreground rounded-bl-sm")}>
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    {m.image_url && (
                      <a href={m.image_url} target="_blank" rel="noreferrer">
                        <img src={m.image_url} alt="attachment" className={cn("max-h-80 rounded-lg", m.content && "mt-2")} />
                      </a>
                    )}
                  </div>
                  <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                    {m.sender} · {format(new Date(m.created_at), "p")}
                  </span>
                </div>
              </div>
            );
          })}
          {/* touch i to satisfy noUnused if strict */}
          <div className="hidden">{data.messages.length}</div>
        </div>
      </section>
    </main>
  );
}
