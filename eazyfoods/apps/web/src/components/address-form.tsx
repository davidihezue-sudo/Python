'use client';
import { useState } from 'react';
import { Btn, Check, ErrorNote, Input, Modal, Textarea } from './ui';
import { post, put } from '@/lib/api';

export function AddressModal({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (a: any) => void }) {
  const [a, setA] = useState<any>({ label: 'Home', recipient_name: '', phone: '', line1: '', line2: '', city: '', region: 'ON', postal_code: '', instructions: '', is_default: false, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const s = (k: string) => (v: any) => setA((o: any) => ({ ...o, [k]: v }));
  const fe = (k: string) => err?.details?.fieldErrors?.[k]?.[0] ?? null;
  const submit = async () => {
    setBusy(true); setErr(null);
    const body = { label: a.label || undefined, recipient_name: a.recipient_name || undefined, phone: a.phone || undefined, line1: a.line1, line2: a.line2 || undefined, city: a.city, region: a.region, postal_code: a.postal_code, instructions: a.instructions || undefined, is_default: !!a.is_default };
    try { const r = initial?.id ? await put(`/customers/me/addresses/${initial.id}`, body) : await post('/customers/me/addresses', body); onSaved(r.address); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial?.id ? 'Edit address' : 'Add an address'} onClose={onClose} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={submit}>Save address</Btn></>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="full"><ErrorNote error={err} /></div>
        <Input label="Label" value={a.label} onChange={s('label')} placeholder="Home, Work" /><Input label="Recipient name" value={a.recipient_name} onChange={s('recipient_name')} optional />
        <Input label="Street address" value={a.line1} onChange={s('line1')} full required autoComplete="address-line1" error={fe('line1')} /><Input label="Apartment, suite or buzzer" value={a.line2} onChange={s('line2')} full optional autoComplete="address-line2" />
        <Input label="City" value={a.city} onChange={s('city')} required autoComplete="address-level2" error={fe('city')} /><Input label="Province" value={a.region} onChange={s('region')} required maxLength={3} autoComplete="address-level1" />
        <Input label="Postal code" value={a.postal_code} onChange={s('postal_code')} required autoComplete="postal-code" error={fe('postal_code')} /><Input label="Phone for the driver" type="tel" value={a.phone} onChange={s('phone')} optional autoComplete="tel" />
        <Textarea label="Delivery instructions" value={a.instructions} onChange={s('instructions')} full optional rows={2} hint="Gate code, where to leave the order, or whether to call." />
        <div className="full"><Check label="Use as my default address" checked={!!a.is_default} onChange={s('is_default')} /></div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
