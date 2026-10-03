import { Suspense } from 'react';
import { ResetForm } from '@/components/auth-forms';
export const metadata = { title: 'Choose a new password', robots: { index: false } };
export default function Reset() { return (<div className="wrap" style={{ maxWidth: 440, paddingTop: 40 }}><h1>Choose a new password</h1><div className="card pad"><Suspense><ResetForm /></Suspense></div></div>); }
