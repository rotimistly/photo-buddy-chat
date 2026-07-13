import { createFileRoute } from "@tanstack/react-router";
import { MessageCircleHeart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chats/")({
  component: () => (
    <div className="flex flex-1 items-center justify-center p-10 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <MessageCircleHeart className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-2xl">Choose a conversation</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a thread from the sidebar, or start a new one to reach our team.
        </p>
      </div>
    </div>
  ),
});
