import type { Cents } from '../money.js';

export interface QuoteLine {
  key: string;                 // stable id for the line, the variant id
  variantId: string; productId: string; vendorId: string; categoryIds: string[];
  productType: string; name: string; variantName: string | null; sku: string; imageUrl: string | null;
  unitPrice: Cents; listPrice: Cents; qty: number; taxClass: string; weightGrams: number; portions: number; prepMinutes: number | null;
  minQty: number; maxQty: number | null;
  available: number | null;     // sellable units right now (null = untracked)
  active: boolean;
}
export interface VendorInfo {
  id: string; name: string; slug: string; lat: number | null; lng: number | null; region: string | null; country: string;
  acceptsDelivery: boolean; acceptsPickup: boolean; usesOwnDrivers: boolean; acceptingOrders: boolean; approved: boolean;
  minOrder: Cents; commissionOverridePct: number | null; defaultPrep: number; planDiscountPct: number;
  isOpenAt: (d: Date) => { open: boolean; reason?: string };
  zones: ZoneRow[];            // vendor scoped zones, empty if none
}
export interface ZoneRow {
  id: string; scope: 'platform' | 'vendor'; name: string; zone_type: 'radius' | 'postal' | 'polygon';
  center_lat: number | null; center_lng: number | null; radius_km: number | null; postal_prefixes: string[]; polygon: [number, number][] | null;
  fee_model: 'flat' | 'distance'; base_fee: number; per_km_fee: number; free_over: number | null; min_order: number; max_distance_km: number | null; priority: number;
}
export interface FeeRule { id: string; name: string; kind: 'surcharge' | 'multiplier' | 'discount'; amount: number | null; multiplier: number | null; conditions: Record<string, any>; priority: number }
export interface CommissionRule { id: string; scope: 'global' | 'category' | 'vendor'; vendor_id: string | null; category_id: string | null; percent: number; fixed_fee: number; valid_from: Date | null; valid_to: Date | null }
export interface Promotion {
  id: string; name: string; code: string | null; type: 'percent' | 'fixed' | 'free_delivery' | 'bogo' | 'spend_get' | 'first_order';
  value: number; max_discount: number | null; min_order: number; starts_at: Date | null; ends_at: Date | null;
  usage_limit: number | null; per_customer_limit: number | null; vendor_id: string | null; funded_by: 'platform' | 'vendor';
  scope: { vendor_ids?: string[]; category_ids?: string[]; product_ids?: string[]; product_types?: string[] };
  segment_id: string | null; stackable: boolean; stack_group: string | null; priority: number; auto_apply: boolean; status: string;
  config: Record<string, any>; redemption_count: number;
}
export interface Choice { mode: 'delivery' | 'pickup'; scheduledFor?: Date | null }
export interface AddressPoint { lat: number; lng: number; region: string; postal_code: string; country: string }

export interface QuoteSettings {
  service_fee: { percent: number; min: number; max: number };
  commission: { percent: number; fixed_fee: number };
  orders: { minimum_order: number; schedule_min_lead_minutes: number; schedule_max_days_ahead: number; schedule_window_minutes: number; tip_max_percent: number; max_line_quantity: number };
  delivery: { max_distance_km: number; avg_speed_kmh: Record<string, number>; vendor_prep_buffer_minutes: number };
  promotions: { allow_stacking: boolean; max_stacked: number; max_total_discount_pct: number };
  weather: { severe: boolean };
  dispatch_wait_minutes: number;
}

export interface QuoteInput {
  now: Date;
  currency: string;
  lines: QuoteLine[];
  vendors: Map<string, VendorInfo>;
  choices: Record<string, Choice>;
  address: AddressPoint | null;
  promotions: Promotion[];
  couponCodes: string[];
  customer: { isFirstOrder: boolean; redemptions: Map<string, number>; segmentIds: Set<string>; creditBalance: Cents; useCredit: boolean };
  tip: Cents;
  platformZones: ZoneRow[];
  feeRules: FeeRule[];
  commissionRules: CommissionRule[];
  taxRate: (region: string | null, country: string, taxClass: string) => number;
  demandRatio: number;
  settings: QuoteSettings;
}

export interface QuotedLine {
  variantId: string; productId: string; vendorId: string; productType: string; name: string; variantName: string | null; sku: string; imageUrl: string | null;
  qty: number; unitPrice: Cents; listPrice: Cents; lineSubtotal: Cents; discountVendor: Cents; discountPlatform: Cents;
  taxClass: string; taxRate: number; tax: Cents; portions: number; commission: Cents; commissionRate: number; available: number | null;
}
export interface DeliveryQuote {
  available: boolean; reason?: string; distanceKm: number | null; zoneId: string | null; zoneName: string | null;
  estimatedMinutes: number | null; etaAt: Date | null; weightGrams: number; needsCold: boolean;
}
export interface GroupQuote {
  vendorId: string; vendorName: string; vendorSlug: string;
  fulfillmentType: 'delivery_platform' | 'delivery_vendor' | 'pickup'; mode: 'delivery' | 'pickup'; scheduledFor: Date | null;
  lines: QuotedLine[];
  itemsSubtotal: Cents; vendorDiscount: Cents; platformDiscount: Cents; tax: Cents;
  deliveryFee: Cents; deliverySubsidyVendor: Cents; deliverySubsidyPlatform: Cents; deliveryFeePayable: Cents;
  serviceFee: Cents; tip: Cents; commission: Cents; commissionRate: number; fixedFee: Cents; vendorNet: Cents; customerTotal: Cents;
  delivery: DeliveryQuote; prepMinutes: number; portions: number; minOrderShortfall: Cents;
  warnings: { code: string; message: string }[];
}
export interface Quote {
  currency: string; groups: GroupQuote[];
  subtotal: Cents; vendorDiscount: Cents; platformDiscount: Cents; discountTotal: Cents; tax: Cents;
  deliveryFee: Cents; deliverySubsidy: Cents; deliveryFeePayable: Cents; serviceFee: Cents; tip: Cents;
  total: Cents; creditApplied: Cents; amountDue: Cents;
  appliedPromotions: { id: string; name: string; code: string | null; amount: Cents; funded_by: string }[];
  rejectedCoupons: { code: string; reason: string }[];
  warnings: { code: string; message: string }[];
  blockers: { code: string; message: string; vendorId?: string; variantId?: string }[];
  canCheckout: boolean;
}
