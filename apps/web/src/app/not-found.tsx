import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page you are looking for does not exist or is not available yet.</p>
      <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
        Back to dashboard
      </Link>
    </main>
  );
}
