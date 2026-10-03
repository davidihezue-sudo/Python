// Pure permission rules. Server code must call these (via services/access.ts) on every protected operation.
export type VehicleLevel = "OWNER" | "CO_OWNER" | "MAINTENANCE_MANAGER" | "VIEWER";
export type HouseholdRoleT = "ADMIN" | "MEMBER" | "READ_ONLY" | "CHILD" | "ACCOUNTANT";
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
  // Read-only members can look at what has been shared with them but can never change anything.
  if (a.householdRole === "READ_ONLY" || a.householdRole === "CHILD" || a.householdRole === "ACCOUNTANT") {
    if (!a.vehicleLevel) return false;
    return cap === "view" || (cap === "viewFinancials" && a.canViewFinancials);
  }
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
