import { ForgotForm } from '@/components/auth-forms';
export const metadata = { title: 'Reset your password', robots: { index: false } };
export default function Forgot() { return (<div className="wrap" style={{ maxWidth: 440, paddingTop: 40 }}><h1>Reset your password</h1><div className="card pad"><ForgotForm /></div></div>); }
