// Role based access control. Roles and permissions are data; check permissions, never role names, in handlers.
import { query, one, type Db, pool } from '../db.js';
import type { AuthCtx } from './auth.js';
import { forbidden, unauthorized } from '../errors.js';

export const PERMISSIONS: Record<string, [area: string, description: string]> = {
  'users.read': ['Users', 'View user accounts'],
  'users.manage': ['Users', 'Create, suspend and reactivate user accounts'],
  'roles.manage': ['Users', 'Assign staff roles and edit role permissions'],
  'customers.read': ['Customers', 'View customer profiles and order history'],
  'customers.suspend': ['Customers', 'Suspend or reactivate customers'],
  'vendors.read': ['Vendors', 'View vendors and chefs'],
  'vendors.approve': ['Vendors', 'Approve, reject or suspend vendors and chefs'],
  'vendors.manage': ['Vendors', 'Edit any vendor store, catalog and settings'],
  'drivers.read': ['Drivers', 'View drivers'],
  'drivers.approve': ['Drivers', 'Approve, reject, suspend or reactivate drivers'],
  'drivers.manage': ['Drivers', 'Manage driver profiles, jobs and assignments'],
  'dispatch.manage': ['Drivers', 'Reassign drivers and manage dispatch'],
  'catalog.manage': ['Catalog', 'Manage categories, brands and any product'],
  'orders.read': ['Orders', 'View any order'],
  'orders.manage': ['Orders', 'Change operational status, add notes'],
  'orders.cancel': ['Orders', 'Cancel orders'],
  'payments.read': ['Finance', 'View payments and transactions'],
  'refunds.issue': ['Finance', 'Issue full and partial refunds'],
  'payouts.read': ['Finance', 'View payouts'],
  'payouts.manage': ['Finance', 'Create, hold and release payouts'],
  'ledger.read': ['Finance', 'View the financial ledger'],
  'promotions.manage': ['Marketing', 'Manage promotions and coupons'],
  'marketing.manage': ['Marketing', 'Manage homepage, collections, banners and campaigns'],
  'ads.manage': ['Marketing', 'Manage advertising placements'],
  'segments.manage': ['Marketing', 'Manage customer segments'],
  'content.manage': ['Content', 'Manage articles, recipes, FAQ and landing pages'],
  'support.read': ['Support', 'View support tickets'],
  'support.manage': ['Support', 'Respond to and assign tickets'],
  'disputes.resolve': ['Support', 'Resolve disputes'],
  'reviews.moderate': ['Support', 'Moderate reviews'],
  'compliance.read': ['Compliance', 'View compliance documents'],
  'compliance.manage': ['Compliance', 'Verify documents and manage rules'],
  'settings.read': ['Platform', 'View platform settings'],
  'settings.manage': ['Platform', 'Change platform settings, fees and zones'],
  'analytics.read': ['Analytics', 'View platform analytics'],
  'audit.read': ['Platform', 'View audit logs'],
  'fraud.read': ['Risk', 'View risk signals'],
  'fraud.manage': ['Risk', 'Review risk signals'],
  'search.global': ['Platform', 'Use global admin search'],
};
const ALL = Object.keys(PERMISSIONS);

export const ROLES: Record<string, { name: string; kind: 'customer' | 'vendor' | 'chef' | 'driver' | 'staff'; description: string; perms: string[] }> = {
  customer: { name: 'Customer', kind: 'customer', description: 'Shops on the marketplace', perms: [] },
  vendor: { name: 'Vendor', kind: 'vendor', description: 'Sells groceries or prepared food', perms: [] },
  chef: { name: 'Chef', kind: 'chef', description: 'Independent chef', perms: [] },
  driver: { name: 'Driver', kind: 'driver', description: 'Independent delivery driver', perms: [] },
  super_admin: { name: 'Super Admin', kind: 'staff', description: 'Full platform control', perms: ALL },
  operations_admin: { name: 'Operations Admin', kind: 'staff', description: 'Runs day to day operations', perms: ['users.read', 'customers.read', 'vendors.read', 'drivers.read', 'drivers.manage', 'dispatch.manage', 'orders.read', 'orders.manage', 'orders.cancel', 'payments.read', 'support.read', 'support.manage', 'disputes.resolve', 'analytics.read', 'audit.read', 'fraud.read', 'search.global', 'compliance.read', 'settings.read', 'reviews.moderate'] },
  vendor_admin: { name: 'Vendor Admin', kind: 'staff', description: 'Onboards and manages vendors', perms: ['vendors.read', 'vendors.approve', 'vendors.manage', 'catalog.manage', 'compliance.read', 'compliance.manage', 'orders.read', 'search.global', 'analytics.read'] },
  customer_support: { name: 'Customer Support', kind: 'staff', description: 'Handles tickets and disputes', perms: ['customers.read', 'orders.read', 'orders.manage', 'support.read', 'support.manage', 'disputes.resolve', 'refunds.issue', 'payments.read', 'reviews.moderate', 'search.global', 'vendors.read', 'drivers.read'] },
  finance_admin: { name: 'Finance Admin', kind: 'staff', description: 'Payments, refunds, payouts and ledger', perms: ['orders.read', 'payments.read', 'refunds.issue', 'payouts.read', 'payouts.manage', 'ledger.read', 'analytics.read', 'settings.read', 'audit.read', 'search.global', 'vendors.read', 'drivers.read'] },
  marketing_manager: { name: 'Marketing Manager', kind: 'staff', description: 'Leads marketing', perms: ['promotions.manage', 'marketing.manage', 'ads.manage', 'segments.manage', 'content.manage', 'analytics.read', 'catalog.manage', 'vendors.read', 'search.global'] },
  marketing_staff: { name: 'Marketing Staff', kind: 'staff', description: 'Runs campaigns', perms: ['promotions.manage', 'marketing.manage', 'content.manage', 'segments.manage', 'vendors.read'] },
  driver_operations: { name: 'Driver Operations', kind: 'staff', description: 'Driver onboarding and dispatch', perms: ['drivers.read', 'drivers.approve', 'drivers.manage', 'dispatch.manage', 'orders.read', 'compliance.read', 'compliance.manage', 'support.read', 'support.manage', 'search.global'] },
  compliance_officer: { name: 'Compliance Officer', kind: 'staff', description: 'Verifies documents and food safety', perms: ['compliance.read', 'compliance.manage', 'vendors.read', 'vendors.approve', 'drivers.read', 'drivers.approve', 'audit.read', 'search.global'] },
  content_manager: { name: 'Content Manager', kind: 'staff', description: 'Blog, recipes, FAQ and landing pages', perms: ['content.manage', 'marketing.manage', 'catalog.manage'] },
  chef_operations: { name: 'Chef Operations', kind: 'staff', description: 'Chef onboarding and kitchen operations', perms: ['vendors.read', 'vendors.approve', 'vendors.manage', 'compliance.read', 'compliance.manage', 'orders.read', 'search.global', 'catalog.manage'] },
};

export async function seedRbac(db: Db = pool) {
  for (const [key, [area, description]] of Object.entries(PERMISSIONS)) {
    await query(`INSERT INTO permissions(key, area, description) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET area=$2, description=$3`, [key, area, description], db);
  }
  for (const [key, r] of Object.entries(ROLES)) {
    const role = await one<{ id: string }>(
      `INSERT INTO roles(key, name, kind, description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET name=$2, description=$4 RETURNING id`, [key, r.name, r.kind, r.description], db);
    // Only seed permissions for roles that have none yet, so admin edits are preserved.
    const existing = await one<{ n: number }>('SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1', [role!.id], db);
    if (!existing!.n) for (const p of r.perms) await query('INSERT INTO role_permissions(role_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role!.id, p], db);
  }
}

export async function assignRole(userId: string, roleKey: string, grantedBy: string | null = null, db: Db = pool) {
  await query(`INSERT INTO user_roles(user_id, role_id, granted_by) SELECT $1, id, $3 FROM roles WHERE key = $2 ON CONFLICT DO NOTHING`, [userId, roleKey, grantedBy], db);
}

export const can = (a: AuthCtx | null | undefined, perm: string) => !!a && a.perms.has(perm);
export function requirePerm(a: AuthCtx | null | undefined, ...perms: string[]): AuthCtx {
  if (!a) throw unauthorized();
  if (!perms.some((p) => a.perms.has(p))) throw forbidden();
  return a;
}
export function requireUser(a: AuthCtx | null | undefined): AuthCtx {
  if (!a) throw unauthorized();
  return a;
}
export const isStaff = (a: AuthCtx) => a.roles.some((r) => ROLES[r]?.kind === 'staff');

// Vendor side capabilities by team role.
export type VendorCap = 'orders' | 'inventory' | 'catalog' | 'promotions' | 'settings' | 'finance' | 'team' | 'reviews' | 'support';
const CAPS: Record<string, VendorCap[]> = {
  owner: ['orders', 'inventory', 'catalog', 'promotions', 'settings', 'finance', 'team', 'reviews', 'support'],
  manager: ['orders', 'inventory', 'catalog', 'promotions', 'settings', 'reviews', 'support'],
  staff: ['orders', 'inventory', 'support'],
};
/** Returns true when the caller may act for the vendor. Platform staff with vendors.manage may act for any vendor (audited by callers). */
export function vendorAccess(a: AuthCtx, vendorId: string, cap: VendorCap): boolean {
  if (a.perms.has('vendors.manage')) return true;
  const m = a.memberships.find((x) => x.vendor_id === vendorId);
  return !!m && CAPS[m.member_role].includes(cap);
}
export function requireVendor(a: AuthCtx | null | undefined, vendorId: string, cap: VendorCap): AuthCtx {
  const auth = requireUser(a);
  if (!vendorAccess(auth, vendorId, cap)) throw forbidden();
  return auth;
}
