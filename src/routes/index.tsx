import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, LifeBuoy, ShieldCheck } from "lucide-react";
import { registerUser, lookupUserCredentials } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Support — sign in with your name and code" },
      {
        name: "description",
        content: "Sign in with your name and 4-digit code to chat with our support team.",
      },
      { property: "og:title", content: "Support — sign in with your name and code" },
      {
        property: "og:description",
        content: "Sign in with your name and 4-digit code to chat with our support team.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setChecked(true);
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", data.session.user.id)
        .maybeSingle();
      if (prof?.is_admin) navigate({ to: "/ops-console-9f2a" });
      else navigate({ to: "/chat" });
    });
  }, [navigate]);

  if (!checked) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <LifeBuoy className="h-5 w-5" />
          </div>
          <span className="font-display text-xl">Support</span>
        </div>
      </header>

      <section className="mx-auto grid max-w-5xl gap-10 px-6 pb-24 pt-8 md:grid-cols-2 md:items-center">
        <div>
          <p className="text-sm uppercase tracking-widest text-muted-foreground">
            Support platform
          </p>
          <h1 className="mt-3 font-display text-5xl leading-tight sm:text-6xl">
            Talk to a real person.
            <br />
            <span className="italic text-primary">Just a name and a code.</span>
          </h1>
          <p className="mt-6 max-w-md text-muted-foreground">
            Enter your name and a 4-digit code. We'll create your account instantly and connect you
            to a support administrator.
          </p>
          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Private conversation with your assigned
            administrator only.
          </div>
        </div>
        <AuthCard />
      </section>
    </main>
  );
}

function AuthCard() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      toast.error("Please enter a name (1–40 characters).");
      return;
    }
    if (!/^\d{4}$/.test(code)) {
      toast.error("Code must be exactly 4 digits.");
      return;
    }
    setBusy(true);
    try {
      let creds: { email: string; password: string };
      if (mode === "register") {
        creds = await registerUser({ data: { name: trimmed, code } });
      } else {
        creds = await lookupUserCredentials({ data: { name: trimmed, code } });
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
      });
      if (error) {
        if (mode === "login") throw new Error("No account matches that name and code.");
        throw error;
      }
      navigate({ to: "/chat" });
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex rounded-full bg-muted p-1">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${mode === "login" ? "bg-background shadow" : "text-muted-foreground"}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${mode === "register" ? "bg-background shadow" : "text-muted-foreground"}`}
        >
          Create account
        </button>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
            autoComplete="off"
            maxLength={40}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">4-digit code</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="1234"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            required
          />
          {mode === "register" && (
            <p className="text-xs text-muted-foreground">
              Pick any 4 digits — you'll use them to sign back in.
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "register" ? "Create account" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
