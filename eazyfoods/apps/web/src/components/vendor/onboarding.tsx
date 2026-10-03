'use client';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, ErrorNote, Input, Modal, Select, Spinner, Table, useToast } from '../ui';
import { post, upload } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { date, label } from '@/lib/format';

export function DocumentUploader({ owner, requirements, onDone, post: submit }: { owner: string; requirements: any[]; onDone: () => void; post: (b: any) => Promise<any> }) {
  const toast = useToast();
  const [t, setT] = useState(requirements[0]?.doc_type ?? ''); const [ref, setRef] = useState(''); const [issue, setIssue] = useState(''); const [exp, setExp] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  return (
    <form className="card pad stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { let fileId: string | undefined; if (file) fileId = (await upload(file, 'document')).id; await submit({ docType: t, fileId, reference: ref || undefined, issueDate: issue || undefined, expiryDate: exp || undefined }); toast('Document submitted for review'); setFile(null); setRef(''); onDone(); } catch (x) { setErr(x); } finally { setBusy(false); }
    }}>
      <h3 style={{ margin: 0 }}>Upload a document</h3><ErrorNote error={err} />
      <div className="form-grid">
        <Select label="Document" value={t} onChange={setT} options={requirements.map((r) => ({ value: r.doc_type, label: `${r.label}${r.required ? ' (required)' : ''}` }))} /><Input label="Reference number" value={ref} onChange={setRef} optional />
        <Input label="Issue date" type="date" value={issue} onChange={setIssue} optional /><Input label="Expiry date" type="date" value={exp} onChange={setExp} optional hint="We remind you before it expires." />
        <div className="full"><label className="label" htmlFor={`f-${owner}`}>File (PDF, JPG or PNG)</label><input id={`f-${owner}`} type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      </div>
      <div><Btn type="submit" variant="primary" busy={busy}>Submit document</Btn></div>
    </form>
  );
}

export function VendorOnboarding() {
  const { vendorId, base } = useVendor(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/vendors/${vendorId}/manage`); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  if (!data) return error ? <ErrorNote error={error} retry={reload} /> : <Spinner />;
  const v = data.vendor;
  const have = (t: string) => data.documents.find((d: any) => d.doc_type === t && ['verified', 'pending'].includes(d.status));
  const profileDone = !!(v.description && v.logo_url && v.line1 && v.postal_code && data.hours.some((h: any) => !h.is_closed));
  const docsDone = data.requirements.filter((r: any) => r.required).every((r: any) => have(r.doc_type));
  return (
    <>
      <PageHead title="Onboarding and documents" sub="Complete these steps so we can approve your account. Approval is checked by our team." actions={<Badge status={v.verification_status} />} />
      {v.verification_note && <div className="alert warn" style={{ marginBottom: 14 }}><b>Note from our team:</b> {v.verification_note}</div>}
      <ol className="stack" style={{ paddingLeft: 20 }}>
        <li><b>Profile</b> {profileDone ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Needs work</Badge>}<div className="small muted">Description, logo, address and opening hours. <a href={`${base}/settings`}>Edit profile</a></div></li>
        <li><b>Documents</b> {docsDone ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Missing</Badge>}<div className="small muted">Required: {data.requirements.filter((r: any) => r.required).map((r: any) => r.label).join(', ')}.</div></li>
        <li><b>Products</b> <div className="small muted">Add at least one product. <a href={`${base}/products`}>Add products</a></div></li>
        <li><b>Submit for review</b><div><ErrorNote error={err} /><Btn variant="primary" busy={busy} disabled={!['draft', 'rejected', 'needs_changes'].includes(v.verification_status) || !profileDone || !docsDone} onClick={async () => { setBusy(true); setErr(null); try { await post(`/vendors/${vendorId}/submit`); toast('Submitted. We will review it shortly.'); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Submit for review</Btn></div></li>
      </ol>
      <h2 style={{ fontSize: '1.2rem', marginTop: 28 }}>Your documents</h2>
      <Table caption="Documents" rows={data.documents} empty="No documents uploaded yet." cols={[{ key: 'doc_type', header: 'Document', render: (r: any) => label(r.doc_type) }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'expiry_date', header: 'Expires', render: (r: any) => (r.expiry_date ? date(r.expiry_date) : '') }, { key: 'review_note', header: 'Reviewer note' }]} />
      <div style={{ marginTop: 18, maxWidth: 720 }}><DocumentUploader owner={vendorId} requirements={data.requirements} onDone={reload} post={(b) => post(`/vendors/${vendorId}/documents`, b)} /></div>
    </>
  );
}
void Modal;
