"use client";
import * as React from "react";
import { Button, Textarea } from "@/components/ui/primitives";
import { useFin, useFinMutation, useFinQuery } from "./provider";

/** Notes between household members on one record. Only people who can see the record can read or write here. */
export function CommentsPanel({ entity, entityId }: { entity: "transaction" | "bill" | "goal" | "income" | "debt" | "wish"; entityId: string }) {
  const { fmt, profile } = useFin();
  const [text, setText] = React.useState("");
  const { data } = useFinQuery<any[]>("/comments", { entity, entityId });
  const add = useFinMutation<any, any>("POST", "/comments", { onSuccess: () => setText("") });
  const del = useFinMutation<any, any>("DELETE", (b) => `/comments/${b.id}`);
  const canComment = profile && profile.myRole !== "READ_ONLY";
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">Comments</p>
      {(data ?? []).length === 0 && <p className="mb-2 text-sm text-muted-foreground">No comments yet.</p>}
      <ul className="mb-2 space-y-2">
        {(data ?? []).map((c) => (
          <li key={c.id} className="rounded-md border border-border bg-muted/30 p-2 text-sm">
            <p className="whitespace-pre-wrap">{c.body}</p>
            <p className="mt-1 flex items-center justify-between text-xs text-muted-foreground"><span>{c.author?.name ?? "Someone"} · {fmt.date(c.createdAt.slice(0, 10))}</span>{c.canDelete && <button className="text-danger hover:underline" onClick={() => del.mutate({ id: c.id })}>Delete</button>}</p>
          </li>
        ))}
      </ul>
      {canComment && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate({ entity, entityId, body: text.trim() }); }} className="flex items-end gap-2">
          <Textarea aria-label="Add a comment" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Write a note" className="flex-1" />
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>Post</Button>
        </form>
      )}
    </div>
  );
}
