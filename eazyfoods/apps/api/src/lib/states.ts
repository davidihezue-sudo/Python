// Order and delivery state machines. Status changes outside these tables are rejected.
import { AppError } from '../errors.js';

export type SuborderStatus =
  | 'pending_payment' | 'confirmed' | 'vendor_accepted' | 'preparing' | 'ready_for_pickup' | 'driver_assigned' | 'driver_arriving'
  | 'picked_up' | 'in_transit' | 'delivered' | 'completed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'disputed';

export const SUBORDER_TRANSITIONS: Record<SuborderStatus, SuborderStatus[]> = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['vendor_accepted', 'cancelled'],
  vendor_accepted: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['driver_assigned', 'picked_up', 'cancelled'],
  driver_assigned: ['driver_arriving', 'picked_up', 'ready_for_pickup', 'cancelled'],
  driver_arriving: ['picked_up', 'driver_assigned', 'cancelled'],
  picked_up: ['in_transit', 'completed', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: ['completed', 'disputed', 'partially_refunded', 'refunded'],
  completed: ['disputed', 'partially_refunded', 'refunded'],
  cancelled: [],
  refunded: [],
  partially_refunded: ['disputed', 'refunded', 'partially_refunded', 'completed'],
  disputed: ['completed', 'partially_refunded', 'refunded'],
};
export const TERMINAL_SUBORDER: SuborderStatus[] = ['completed', 'cancelled', 'refunded', 'partially_refunded'];
export const ACTIVE_SUBORDER: SuborderStatus[] = ['confirmed', 'vendor_accepted', 'preparing', 'ready_for_pickup', 'driver_assigned', 'driver_arriving', 'picked_up', 'in_transit'];

/** Which statuses each fulfillment type may pass through. */
export const FULFILLMENT_FORBIDS: Record<string, SuborderStatus[]> = {
  pickup: ['driver_assigned', 'driver_arriving', 'in_transit', 'delivered'],
  delivery_vendor: ['driver_assigned', 'driver_arriving'],
  delivery_platform: [],
};

export function assertSuborderTransition(from: SuborderStatus, to: SuborderStatus, fulfillment: string) {
  if (!SUBORDER_TRANSITIONS[from]?.includes(to) || FULFILLMENT_FORBIDS[fulfillment]?.includes(to)) {
    throw new AppError('INVALID_TRANSITION', 409, 'That order can not move to that step right now.', { from, to }, `Illegal suborder transition ${from} -> ${to} (${fulfillment})`);
  }
  // Pickup and vendor delivery skip delivery states; picked_up -> completed is only for pickup.
  if (from === 'picked_up' && to === 'completed' && fulfillment !== 'pickup') {
    throw new AppError('INVALID_TRANSITION', 409, 'That order can not move to that step right now.', { from, to });
  }
  if (from === 'picked_up' && to === 'in_transit' && fulfillment === 'pickup') {
    throw new AppError('INVALID_TRANSITION', 409, 'That order can not move to that step right now.', { from, to });
  }
}

export type DeliveryStatus = 'waiting_for_ready' | 'awaiting_driver' | 'offered' | 'assigned' | 'at_pickup' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  waiting_for_ready: ['awaiting_driver', 'cancelled'],
  awaiting_driver: ['offered', 'assigned', 'cancelled'],
  offered: ['awaiting_driver', 'assigned', 'cancelled'],
  assigned: ['at_pickup', 'awaiting_driver', 'picked_up', 'cancelled', 'failed'],
  at_pickup: ['picked_up', 'awaiting_driver', 'cancelled', 'failed'],
  picked_up: ['in_transit', 'failed', 'cancelled'],
  in_transit: ['delivered', 'failed', 'cancelled'],
  delivered: [],
  failed: [],
  cancelled: [],
};
export function assertDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus) {
  if (!DELIVERY_TRANSITIONS[from]?.includes(to)) {
    throw new AppError('INVALID_TRANSITION', 409, 'That delivery can not move to that step right now.', { from, to }, `Illegal delivery transition ${from} -> ${to}`);
  }
}

export type VendorVerification = 'draft' | 'submitted' | 'under_review' | 'info_required' | 'approved' | 'rejected' | 'suspended';
export const VERIFICATION_TRANSITIONS: Record<VendorVerification, VendorVerification[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'info_required', 'approved', 'rejected'],
  under_review: ['info_required', 'approved', 'rejected'],
  info_required: ['submitted'],
  approved: ['suspended'],
  rejected: ['submitted'],
  suspended: ['approved', 'under_review'],
};
export function assertVerification(from: VendorVerification, to: VendorVerification) {
  if (!VERIFICATION_TRANSITIONS[from]?.includes(to)) throw new AppError('INVALID_TRANSITION', 409, `This application can not move from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}.`);
}

export const SUBORDER_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting payment', confirmed: 'Order placed', vendor_accepted: 'Accepted by store', preparing: 'Preparing', ready_for_pickup: 'Ready',
  driver_assigned: 'Driver assigned', driver_arriving: 'Driver arriving', picked_up: 'Picked up', in_transit: 'On the way', delivered: 'Delivered',
  completed: 'Completed', cancelled: 'Cancelled', refunded: 'Refunded', partially_refunded: 'Partially refunded', disputed: 'In dispute',
};
