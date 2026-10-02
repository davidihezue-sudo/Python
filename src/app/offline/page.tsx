export const metadata = { title: "Offline" };
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold">You're offline</h1>
      <p className="mt-2 text-muted-foreground">This page hasn't been saved on this device yet. Pages and records you've already opened are still available, and anything you add will sync when you're back online.</p>
      <a href="/dashboard" className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try the dashboard</a>
    </main>
  );
}
