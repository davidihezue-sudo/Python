'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AddressModal } from '@/components/address-form';
import { Badge, Btn, Confirm, Empty, ErrorNote, Spinner } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { del } from '@/lib/api';

function Inner() {
  const { data, error, loading, reload } = useApi<any>('/customers/me/addresses');
  const [edit, setEdit] = useState<any>(null); const [rm, setRm] = useState<any>(null);
  const sp = useSearchParams();
  if (loading && !data) return <Spinner />;
  return (
    <div><div className="row spread"><h2 style={{ margin: 0 }}>Addresses</h2><Btn variant="primary" onClick={() => setEdit({})}>Add address</Btn></div>
      <ErrorNote error={error} retry={reload} />
      {sp.get('next') && <p className="alert">After saving, <a href={sp.get('next')!}>go back</a>.</p>}
      {data && !data.addresses.length && <Empty title="No saved addresses">Add an address to get exact delivery fees and times.</Empty>}
      <div className="grid cols-2" style={{ marginTop: 14 }}>{data?.addresses.map((a: any) => (
        <div key={a.id} className="card pad"><div className="row spread"><b>{a.label ?? 'Address'}</b>{a.is_default && <Badge>Default</Badge>}</div><p className="small" style={{ margin: '8px 0' }}>{a.recipient_name && <>{a.recipient_name}<br /></>}{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.region} {a.postal_code}{a.instructions && <><br /><i>{a.instructions}</i></>}</p><div className="row"><Btn size="sm" variant="secondary" onClick={() => setEdit(a)}>Edit</Btn><Btn size="sm" variant="ghost" onClick={() => setRm(a)}>Remove</Btn></div></div>))}</div>
      {edit && <AddressModal initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={() => reload()} />}
      {rm && <Confirm title="Remove this address?" danger confirmLabel="Remove" onClose={() => setRm(null)} onConfirm={async () => { await del(`/customers/me/addresses/${rm.id}`); reload(); }}><p>{rm.line1}, {rm.city}</p></Confirm>}
    </div>
  );
}
export default function Addresses() { return <Suspense><Inner /></Suspense>; }
