import { db } from "@/lib/db";
import { register, verifyEmail, login } from "@/server/services/auth";
import { createVehicle } from "@/server/services/vehicles";
import { actorFromUser, type Actor } from "@/server/context";

let n = 0;
export async function createActor(name = "Test User", email?: string): Promise<Actor> {
  n++;
  const e = (email ?? `user${n}-${Date.now()}@example.com`).toLowerCase();
  await register({ name, email: e, password: "CorrectHorse9!", acceptTerms: true });
  const mail = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: e, subject: { contains: "Verify" } }, orderBy: { createdAt: "desc" } });
  const token = /token=([\w-]+)/.exec(mail.text)![1];
  await verifyEmail(token);
  const user = await db.user.findUniqueOrThrow({ where: { email: e }, include: { preference: true } });
  return actorFromUser(user);
}

export async function reloadActor(a: Actor): Promise<Actor> {
  const user = await db.user.findUniqueOrThrow({ where: { id: a.id }, include: { preference: true } });
  return actorFromUser(user);
}

export const baseVehicle = { make: "BMW", model: "X3", year: 2015, fuelType: "PETROL" as const, ownershipStatus: "OWNED" as const, applySuggestedSchedules: true };

export async function createTestVehicle(actor: Actor, over: Record<string, unknown> = {}) {
  const { id } = await createVehicle(actor, { ...baseVehicle, nickname: "Test X3", currentOdometerKm: 160000, odometerDate: "2024-01-01", ...over } as any);
  return id;
}

export { login };
