import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 w-full max-w-md rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-7 w-7 text-[#f26a4f]" />
        <h1 className="text-2xl font-bold">Page not found</h1>
      </div>
      <p className="mt-4 text-sm text-[#77798a]">This page doesn't exist or has moved.</p>
      <Link href="/dashboard" className="mt-5 inline-block text-sm font-bold text-[#f26a4f]">Back to dashboard</Link>
    </div>
  );
}
