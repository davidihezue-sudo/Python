"use client";
import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { flushQueue, listQueue } from "@/lib/client/offline";
import { makeFormatters, type Formatters } from "@/lib/client/format";
import { ConfirmProvider } from "@/components/ui/dialog";
import { ToastProvider, useToast } from "@/components/ui/toast";

export interface Me {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  platformRole: "USER" | "PLATFORM_ADMIN";
  imageUrl: string | null;
  hasPassword: boolean;
  linkedProviders: string[];
  preferences: any;
  households: { id: string; name: string; role: "ADMIN" | "MEMBER" }[];
  googleEnabled: boolean;
}

const MeContext = React.createContext<Me | null>(null);
const FormatContext = React.createContext<Formatters | null>(null);
export const useMe = () => React.useContext(MeContext) as Me;
export const useFormat = () => React.useContext(FormatContext) as Formatters;

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        networkMode: "offlineFirst", // serve cached/previously-loaded data while offline
      },
      mutations: { networkMode: "always" },
    },
  });
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const h = () => {
      window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    };
    window.addEventListener("av:unauthenticated", h);
    return () => window.removeEventListener("av:unauthenticated", h);
  }, []);
  return <>{children}</>;
}

export function AppProviders({ initialMe, children }: { initialMe: Me; children: React.ReactNode }) {
  const [client] = React.useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <MeProvider initialMe={initialMe}>
            <AuthGuard>
              <OfflineSync />
              {children}
            </AuthGuard>
          </MeProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function MeProvider({ initialMe, children }: { initialMe: Me; children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/users/me"), initialData: initialMe, staleTime: 60_000 });
  const me = data ?? initialMe;
  const fmt = React.useMemo(() => makeFormatters(me.preferences), [me.preferences]);
  return (
    <MeContext.Provider value={me}>
      <FormatContext.Provider value={fmt}>{children}</FormatContext.Provider>
    </MeContext.Provider>
  );
}

/** Flushes the offline queue when connectivity returns, on start-up and when the service worker requests a background sync. */
function OfflineSync() {
  const { toast } = useToast();
  React.useEffect(() => {
    const run = async () => {
      const pending = await listQueue();
      if (!pending.some((p) => p.status === "pending")) return;
      await flushQueue();
    };
    const onSynced = (e: Event) => toast({ title: "Offline changes synced", description: `${(e as CustomEvent).detail.synced} item(s) saved to your account.` });
    const onMsg = (e: MessageEvent) => e.data?.type === "FLUSH" && void run();
    void run();
    window.addEventListener("online", run);
    window.addEventListener("av:synced", onSynced);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("online", run);
      window.removeEventListener("av:synced", onSynced);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [toast]);
  return null;
}

// ───── selected vehicle

interface VehicleCtx {
  vehicleId: string;
  setVehicleId: (id: string) => void;
}
const VehicleContext = React.createContext<VehicleCtx>({ vehicleId: "all", setVehicleId: () => undefined });
export const useSelectedVehicle = () => React.useContext(VehicleContext);

export interface VehicleLite {
  id: string;
  nickname: string;
  displayName: string;
  year: number;
  make: string;
  model: string;
  currentOdometerKm: number | null;
  photoUrl: string | null;
  canWrite: boolean;
  canViewFinancials: boolean;
  currency: string;
  fuelType: string;
  isDemo: boolean;
  [k: string]: any;
}
export function useVehicles() {
  return useQuery({ queryKey: ["vehicles"], queryFn: () => api<VehicleLite[]>("/api/vehicles") });
}

export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const [vehicleId, setId] = React.useState("all");
  React.useEffect(() => {
    try {
      setId(localStorage.getItem("av:vehicle") || "all");
    } catch {
      /* storage blocked */
    }
  }, []);
  const { data: vehicles } = useVehicles();
  React.useEffect(() => {
    if (vehicles && vehicleId !== "all" && !vehicles.some((v) => v.id === vehicleId)) setId("all");
  }, [vehicles, vehicleId]);
  const setVehicleId = React.useCallback((id: string) => {
    setId(id);
    try {
      localStorage.setItem("av:vehicle", id);
    } catch {
      /* ignore */
    }
  }, []);
  return <VehicleContext.Provider value={{ vehicleId, setVehicleId }}>{children}</VehicleContext.Provider>;
}
