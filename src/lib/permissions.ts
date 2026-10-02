// Pure permission rules. Server code must call these (via services/access.ts) on every protected operation.
export type VehicleLevel = "OWNER" | "CO_OWNER" | "MAINTENANCE_MANAGER" | "VIEWER";
export type HouseholdRoleT = "ADMIN" | "MEMBER";
export type Capability = "view" | "write" | "viewFinancials" | "editVehicle" | "manageAccess" | "delete";

export interface AccessInfo {
  householdRole: HouseholdRoleT | null;
  vehicleLevel: VehicleLevel | null;
  canViewFinancials: boolean;
}

export function can(a: AccessInfo | null, cap: Capability): boolean {
  if (!a) return false;
  if (a.householdRole === "ADMIN") return true;
  if (a.householdRole === null) return false;
  switch (a.vehicleLevel) {
    case "OWNER":
      return true;
    case "CO_OWNER":
      return cap !== "manageAccess" && cap !== "delete";
    case "MAINTENANCE_MANAGER":
      if (cap === "view" || cap === "write") return true;
      if (cap === "viewFinancials") return a.canViewFinancials;
      return false;
    case "VIEWER":
      if (cap === "view") return true;
      if (cap === "viewFinancials") return a.canViewFinancials;
      return false;
    default:
      return false;
  }
}

export const LEVEL_DEFAULT_FINANCIALS: Record<VehicleLevel, boolean> = { OWNER: true, CO_OWNER: true, MAINTENANCE_MANAGER: false, VIEWER: false };
