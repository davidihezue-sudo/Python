// The quote: one pure function that prices a multi-vendor cart. Nothing here touches the database.
import { allocate, pctOf, toCents, type Cents } from '../money.js';
import { applyPromotions, type PromoGroup, type PromoLine } from './promotions.js';
import { computeDelivery } from './delivery.js';
import { minutesFor } from '../lib/geo.js';
import type { CommissionRule, GroupQuote, Quote, QuoteInput, QuoteLine, QuotedLine, VendorInfo } from './types.js';

type Warn = { code: string; message: string };
const rulesActive = (r: CommissionRule, now: Date) => (!r.valid_from || new Date(r.valid_from) <= now) && (!r.valid_to || new Date(r.valid_to) > now);

export function resolveCommission(input: QuoteInput, vendor: VendorInfo, line: QuoteLine): { percent: number; fixed: Cents } {
  const rules = input.commissionRules.filter((r) => rulesActive(r, input.now));
  const vendorRule = rules.find((r) => r.scope === 'vendor' && r.vendor_id === vendor.id);
  const globalRule = rules.find((r) => r.scope === 'global');
  let percent: number;
  if (vendor.commissionOverridePct != null) percent = vendor.commissionOverridePct;
  else if (vendorRule) percent = Number(vendorRule.percent);
  else {
    const catRule = line.categoryIds.map((cid) => rules.find((r) => r.scope === 'category' && r.category_id === cid)).find(Boolean);
    percent = catRule ? Number(catRule.percent) : globalRule ? Number(globalRule.percent) : input.settings.commission.percent;
  }
  const fixed = toCents(vendorRule?.fixed_fee ?? globalRule?.fixed_fee ?? input.settings.commission.fixed_fee);
  return { percent: Math.max(0, percent - vendor.planDiscountPct), fixed };
}

export function computeQuote(input: QuoteInput): Quote {
  const { now, settings } = input;
  const blockers: Quote['blockers'] = [];
  const warnings: Warn[] = [];

  // ---- group lines by vendor, validating availability
  const order: string[] = [];
  const byVendor = new Map<string, QuoteLine[]>();
  for (const l of input.lines) {
    if (!byVendor.has(l.vendorId)) { byVendor.set(l.vendorId, []); order.push(l.vendorId); }
    byVendor.get(l.vendorId)!.push(l);
  }
  for (const l of input.lines) {
    if (!l.active) blockers.push({ code: 'PRODUCT_UNAVAILABLE', message: `${l.name} is no longer available. Please remove it from your cart.`, variantId: l.variantId, vendorId: l.vendorId });
    else if (l.available != null && l.qty > l.available) {
      blockers.push({ code: 'INSUFFICIENT_STOCK', message: l.available > 0 ? `Only ${l.available} of ${l.name} left. Please lower the quantity.` : `${l.name} is out of stock.`, variantId: l.variantId, vendorId: l.vendorId });
    } else if (l.qty < l.minQty) blockers.push({ code: 'BELOW_MIN_QTY', message: `${l.name} has a minimum order of ${l.minQty}.`, variantId: l.variantId, vendorId: l.vendorId });
    else if ((l.maxQty != null && l.qty > l.maxQty) || l.qty > settings.orders.max_line_quantity) {
      blockers.push({ code: 'ABOVE_MAX_QTY', message: `${l.name} has a maximum of ${Math.min(l.maxQty ?? Infinity, settings.orders.max_line_quantity)} per order.`, variantId: l.variantId, vendorId: l.vendorId });
    }
  }

  // ---- first pass: fulfillment, delivery feasibility and gross delivery fee per vendor
  interface Draft { vendor: VendorInfo; lines: QuoteLine[]; mode: 'delivery' | 'pickup'; type: GroupQuote['fulfillmentType']; scheduledFor: Date | null; itemsSubtotal: Cents; prep: number; delivery: ReturnType<typeof computeDelivery> | null; warnings: Warn[]; weight: number; types: string[] }
  const drafts: Draft[] = [];
  const multiVendor = order.length > 1;
  for (const vid of order) {
    const vendor = input.vendors.get(vid)!;
    const lines = byVendor.get(vid)!;
    const gw: Warn[] = [];
    const choice = input.choices[vid] ?? { mode: 'delivery' as const };
    const mode = choice.mode;
    const itemsSubtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const prep = Math.max(vendor.defaultPrep, ...lines.map((l) => l.prepMinutes ?? 0));
    const weight = lines.reduce((s, l) => s + l.weightGrams * l.qty, 0);
    const types = [...new Set(lines.map((l) => l.productType))];
    let scheduledFor: Date | null = choice.scheduledFor ?? null;

    if (!vendor.approved) blockers.push({ code: 'VENDOR_UNAVAILABLE', message: `${vendor.name} is not currently accepting orders.`, vendorId: vid });
    else if (!vendor.acceptingOrders) blockers.push({ code: 'VENDOR_PAUSED', message: `${vendor.name} has paused new orders. Please try again later.`, vendorId: vid });
    const when = scheduledFor ?? now;
    const openState = vendor.isOpenAt(when);
    if (!openState.open) blockers.push({ code: 'VENDOR_CLOSED', message: `${vendor.name} is closed${scheduledFor ? ' at your chosen time' : ' right now'}${openState.reason ? ` (${openState.reason})` : ''}. ${scheduledFor ? 'Pick another time.' : 'Schedule your order for later or remove these items.'}`, vendorId: vid });

    if (scheduledFor) {
      const earliest = new Date(now.getTime() + (settings.orders.schedule_min_lead_minutes + prep) * 60000);
      const latest = new Date(now.getTime() + settings.orders.schedule_max_days_ahead * 86400000);
      if (scheduledFor < earliest) blockers.push({ code: 'SCHEDULE_TOO_SOON', message: `${vendor.name} needs more notice. Choose a time after ${earliest.toISOString()}.`, vendorId: vid });
      if (scheduledFor > latest) blockers.push({ code: 'SCHEDULE_TOO_FAR', message: `Orders can be scheduled up to ${settings.orders.schedule_max_days_ahead} days ahead.`, vendorId: vid });
    }

    let delivery: Draft['delivery'] = null;
    let type: Draft['type'] = 'pickup';
    if (mode === 'pickup') {
      if (!vendor.acceptsPickup) blockers.push({ code: 'PICKUP_UNAVAILABLE', message: `${vendor.name} does not offer pickup.`, vendorId: vid });
    } else {
      type = vendor.usesOwnDrivers ? 'delivery_vendor' : 'delivery_platform';
      delivery = computeDelivery(input, vendor, vendor.usesOwnDrivers, { itemsSubtotal, weightGrams: weight, productTypes: types, multiVendor, at: scheduledFor ?? now, demandRatio: input.demandRatio, weatherSevere: settings.weather.severe });
      if (!delivery.available) blockers.push({ code: 'DELIVERY_UNAVAILABLE', message: `${vendor.name}: ${delivery.reason}`, vendorId: vid });
    }
    if (itemsSubtotal < vendor.minOrder) blockers.push({ code: 'VENDOR_MIN_ORDER', message: `${vendor.name} has a minimum order of $${(vendor.minOrder / 100).toFixed(2)}. Add $${((vendor.minOrder - itemsSubtotal) / 100).toFixed(2)} more.`, vendorId: vid });
    drafts.push({ vendor, lines, mode, type, scheduledFor, itemsSubtotal, prep, delivery, warnings: gw, weight, types });
  }

  const orderSubtotal = drafts.reduce((s, d) => s + d.itemsSubtotal, 0);
  if (orderSubtotal < toCents(settings.orders.minimum_order)) blockers.push({ code: 'ORDER_MIN', message: `The minimum order is $${settings.orders.minimum_order.toFixed(2)}.` });

  // ---- promotions across the whole cart
  const promoLines: PromoLine[] = [];
  drafts.forEach((d) => d.lines.forEach((l) => promoLines.push({ idx: promoLines.length, line: l, base: l.unitPrice * l.qty, vendorDisc: 0, platformDisc: 0 })));
  const promoGroups: PromoGroup[] = drafts.map((d) => {
    const fee = d.delivery?.available && d.type === 'delivery_platform' ? d.delivery.grossFee : 0;
    const waived = d.delivery?.freeByThreshold ? fee : 0;
    return { vendorId: d.vendor.id, deliveryPayable: fee - waived, platformDelivery: d.type === 'delivery_platform' && !!d.delivery?.available, deliveryDiscVendor: 0, deliveryDiscPlatform: 0 };
  });
  const promoRes = applyPromotions(input, promoLines, promoGroups);

  // ---- service fee and tip allocation
  const itemsAfter = promoLines.reduce((s, l) => s + l.base - l.vendorDisc - l.platformDisc, 0);
  let serviceFeeTotal = 0;
  if (itemsAfter > 0) {
    serviceFeeTotal = Math.min(toCents(settings.service_fee.max), Math.max(toCents(settings.service_fee.min), pctOf(itemsAfter, settings.service_fee.percent)));
  }
  const serviceParts = allocate(serviceFeeTotal, drafts.map((d) => d.lines.reduce((s, l) => { const pl = promoLines.find((p) => p.line === l)!; return s + pl.base - pl.vendorDisc - pl.platformDisc; }, 0)));
  const tipTargets = drafts.map((d) => (d.type === 'delivery_platform' && d.delivery?.available ? 1 : 0));
  let tipTotal = input.tip;
  if (tipTotal > 0 && !tipTargets.some(Boolean)) { tipTotal = 0; warnings.push({ code: 'TIP_DROPPED', message: 'Tips go to delivery drivers, so no tip was added to this order.' }); }
  const tipCap = pctOf(Math.max(itemsAfter, 1), settings.orders.tip_max_percent);
  if (tipTotal > Math.max(tipCap, 500)) { tipTotal = Math.max(tipCap, 500); warnings.push({ code: 'TIP_CAPPED', message: 'Your tip was reduced to the maximum allowed.' }); }
  const tipParts = tipTotal > 0 ? allocate(tipTotal, tipTargets) : tipTargets.map(() => 0);

  // ---- assemble groups
  const groups: GroupQuote[] = drafts.map((d, gi) => {
    const pg = promoGroups[gi];
    const region = d.mode === 'delivery' ? input.address?.region ?? d.vendor.region : d.vendor.region;
    const country = d.mode === 'delivery' ? input.address?.country ?? d.vendor.country : d.vendor.country;
    const qlines: QuotedLine[] = d.lines.map((l) => {
      const pl = promoLines.find((p) => p.line === l)!;
      const taxable = Math.max(0, pl.base - pl.vendorDisc - pl.platformDisc);
      const rate = input.taxRate(region, country, l.taxClass);
      const com = resolveCommission(input, d.vendor, l);
      const commission = pctOf(Math.max(0, pl.base - pl.vendorDisc), com.percent);
      return {
        variantId: l.variantId, productId: l.productId, vendorId: l.vendorId, productType: l.productType, name: l.name, variantName: l.variantName, sku: l.sku, imageUrl: l.imageUrl,
        qty: l.qty, unitPrice: l.unitPrice, listPrice: l.listPrice, lineSubtotal: pl.base, discountVendor: pl.vendorDisc, discountPlatform: pl.platformDisc,
        taxClass: l.taxClass, taxRate: rate, tax: pctOf(taxable, rate), portions: l.portions * l.qty, commission, commissionRate: com.percent, available: l.available,
      };
    });
    const itemsSubtotal = qlines.reduce((s, l) => s + l.lineSubtotal, 0);
    const vendorDiscount = qlines.reduce((s, l) => s + l.discountVendor, 0);
    const platformDiscount = qlines.reduce((s, l) => s + l.discountPlatform, 0);
    const tax = qlines.reduce((s, l) => s + l.tax, 0);
    const commission = qlines.reduce((s, l) => s + l.commission, 0);
    const grossFee = d.type === 'delivery_platform' && d.delivery?.available ? d.delivery.grossFee : d.type === 'delivery_vendor' && d.delivery?.available ? d.delivery.grossFee : 0;
    const thresholdWaiver = d.delivery?.freeByThreshold ? grossFee : 0;
    const subsidyVendor = (d.delivery?.freeFunder === 'vendor' ? thresholdWaiver : 0) + pg.deliveryDiscVendor;
    const subsidyPlatform = (d.delivery?.freeFunder === 'platform' ? thresholdWaiver : 0) + pg.deliveryDiscPlatform;
    // Vendor delivery is the vendor's own service: the fee is theirs, no marketplace subsidy.
    const payable = Math.max(0, grossFee - subsidyVendor - subsidyPlatform);
    const fixedFee = d.lines.length ? resolveCommission(input, d.vendor, d.lines[0]).fixed : 0;
    const customerTotal = itemsSubtotal - vendorDiscount - platformDiscount + tax + payable + serviceParts[gi] + tipParts[gi];
    const delivery = d.delivery;
    const speed = input.settings.delivery.avg_speed_kmh.car ?? 30;
    const travel = delivery?.available && delivery.distanceKm != null ? minutesFor(delivery.distanceKm, speed) : 0;
    const eta = d.scheduledFor ?? new Date(now.getTime() + (d.prep + settings.delivery.vendor_prep_buffer_minutes + (d.mode === 'delivery' ? settings.dispatch_wait_minutes + travel : 0)) * 60000);
    return {
      vendorId: d.vendor.id, vendorName: d.vendor.name, vendorSlug: d.vendor.slug, fulfillmentType: d.type, mode: d.mode, scheduledFor: d.scheduledFor,
      lines: qlines, itemsSubtotal, vendorDiscount, platformDiscount, tax,
      deliveryFee: grossFee, deliverySubsidyVendor: subsidyVendor, deliverySubsidyPlatform: subsidyPlatform, deliveryFeePayable: payable,
      serviceFee: serviceParts[gi], tip: tipParts[gi], commission, commissionRate: itemsSubtotal - vendorDiscount > 0 ? Math.round((commission / (itemsSubtotal - vendorDiscount)) * 10000) / 100 : 0,
      fixedFee,
      // Own-delivery vendors keep the delivery fee they charge; platform delivered orders can charge the vendor for a vendor funded waiver.
      vendorNet: itemsSubtotal - vendorDiscount - commission - fixedFee + (d.type === 'delivery_vendor' ? grossFee - subsidyVendor : -subsidyVendor), customerTotal,
      delivery: {
        available: d.mode === 'pickup' ? true : !!delivery?.available, reason: delivery?.reason, distanceKm: delivery?.distanceKm ?? null, zoneId: delivery?.zone?.id ?? null,
        zoneName: delivery?.zone?.name ?? null, estimatedMinutes: delivery?.available ? travel : null, etaAt: eta, weightGrams: d.weight, needsCold: d.types.includes('frozen') || d.types.includes('fresh'),
      },
      prepMinutes: d.prep, portions: qlines.reduce((s, l) => s + l.portions, 0),
      minOrderShortfall: Math.max(0, d.vendor.minOrder - itemsSubtotal), warnings: d.warnings,
    };
  });

  const sum = (f: (g: GroupQuote) => number) => groups.reduce((s, g) => s + f(g), 0);
  const total = sum((g) => g.customerTotal);
  const creditApplied = input.customer.useCredit ? Math.min(input.customer.creditBalance, total) : 0;
  for (const r of promoRes.rejected) if (r.code) warnings.push({ code: 'COUPON_REJECTED', message: r.reason });
  const vendorDiscount = sum((g) => g.vendorDiscount), platformDiscount = sum((g) => g.platformDiscount);
  return {
    currency: input.currency, groups,
    subtotal: sum((g) => g.itemsSubtotal), vendorDiscount, platformDiscount, discountTotal: vendorDiscount + platformDiscount,
    tax: sum((g) => g.tax), deliveryFee: sum((g) => g.deliveryFee), deliverySubsidy: sum((g) => g.deliverySubsidyVendor + g.deliverySubsidyPlatform),
    deliveryFeePayable: sum((g) => g.deliveryFeePayable), serviceFee: sum((g) => g.serviceFee), tip: sum((g) => g.tip),
    total, creditApplied, amountDue: total - creditApplied,
    appliedPromotions: promoRes.applied.map((a) => ({ id: a.promo.id, name: a.promo.name, code: a.promo.code, amount: a.amount, funded_by: a.promo.funded_by })),
    rejectedCoupons: promoRes.rejected.filter((r) => r.code),
    warnings, blockers, canCheckout: blockers.length === 0 && groups.length > 0,
  };
}
