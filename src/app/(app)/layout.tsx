import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import { actorFromUser } from "@/server/context";
import { getMe } from "@/server/services/users";
import { AppProviders } from "@/components/shell/providers";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await resolveSession(token);
  if (!s) redirect("/login");
  const me = await getMe(actorFromUser(s.user as any));
  return (
    <AppProviders initialMe={me as any}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
