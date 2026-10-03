import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth-forms';
export const metadata = { title: 'Sign in', robots: { index: false } };
export default function Login() { return (<div className="wrap" style={{ maxWidth: 440, paddingTop: 40 }}><h1>Sign in</h1><div className="card pad"><Suspense><LoginForm /></Suspense></div><p className="center">New here? <Link href="/register">Create an account</Link></p></div>); }
