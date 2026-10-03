import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { endpoint: string; payload: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload });
    }),
  },
}));

import { db } from "@/lib/db";
import { createActor } from "./helpers";
import { savePushSubscription, sendTestPush } from "@/server/services/notifications";

const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}-${Date.now()}-${Math.random()}`, keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });

describe("push test", () => {
  beforeEach(() => { sent.length = 0; failWith = null; });

  it("says clearly when the server has no keys or the device is not subscribed", async () => {
    const a = await createActor("Pusher", `push-${Date.now()}@example.com`);
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
    await expect(sendTestPush(a)).rejects.toThrow(/VAPID/);
    process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests"; process.env.VAPID_PRIVATE_KEY = "PrivateKeyForTests";
    await expect(sendTestPush(a)).rejects.toThrow(/not subscribed/);
  });

  it("sends only to the caller's own devices and drops dead subscriptions", async () => {
    process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests"; process.env.VAPID_PRIVATE_KEY = "PrivateKeyForTests";
    const a = await createActor("Pusher A", `pa-${Date.now()}@example.com`);
    const b = await createActor("Pusher B", `pb-${Date.now()}@example.com`);
    const mine = sub("a"), theirs = sub("b");
    await savePushSubscription(a, mine as never);
    await savePushSubscription(b, theirs as never);
    const r = await sendTestPush(a);
    expect(r).toMatchObject({ devices: 1, sent: 1, removed: 0 });
    expect(sent.map((s) => s.endpoint)).toEqual([mine.endpoint]);
    expect(JSON.parse(sent[0].payload).body).toBe("Notifications are working.");

    failWith = 410; // the phone removed the app: the subscription is deleted, not kept forever
    const gone = await sendTestPush(a);
    expect(gone).toMatchObject({ sent: 0, removed: 1 });
    expect(await db.pushSubscription.count({ where: { userId: a.id } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: b.id } })).toBe(1);
  });
});
