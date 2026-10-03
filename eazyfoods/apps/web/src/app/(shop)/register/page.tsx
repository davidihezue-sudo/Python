import Link from 'next/link';
import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth-forms';
export const metadata = { title: 'Create an account', robots: { index: false } };
export default function Register() { return (<div className="wrap" style={{ maxWidth: 480, paddingTop: 40 }}><h1>Create your account</h1><div className="card pad"><Suspense><RegisterForm /></Suspense></div><p className="center">Already have an account? <Link href="/login">Sign in</Link></p></div>); }
