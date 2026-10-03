'use client';
import { Suspense } from 'react';
import { AdminDispatch } from '@/components/admin/ops';
export default function Page() { return <Suspense><AdminDispatch /></Suspense>; }
