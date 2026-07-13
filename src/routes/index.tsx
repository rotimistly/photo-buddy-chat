import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircleHeart, Share2, Image as ImageIcon, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chats" });
      else setChecked(true);
    });
  }, [navigate]);

  if (!checked) return <div className="min-h-screen bg-background" />;

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-brand text-brand-foreground">
            <MessageCircleHeart className="h-5 w-5" />
          </div>
          <span className="font-display text-xl">Lumen Support</span>
        </div>
        <Link to="/auth" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Sign in
        </Link>
      </header>
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-24 text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">Human support, humane software</p>
        <h1 className="mt-4 font-display text-5xl leading-tight sm:text-6xl">
          Chat with our team.<br />
          <span className="italic text-primary">Share what you need.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-muted-foreground">
          Start a conversation, attach a photo, and pass the whole thread to a teammate with a single link. No bots, no runaround.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/auth" className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            Start a conversation
          </Link>
        </div>
        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          <Feature icon={<ImageIcon className="h-5 w-5" />} title="Photos welcome" body="Attach screenshots or pictures inline." />
          <Feature icon={<Share2 className="h-5 w-5" />} title="Shareable threads" body="Send a link, no login required to read." />
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="Private by default" body="Only you and support can reply." />
        </div>
      </section>
    </main>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-left">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground">{icon}</div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
