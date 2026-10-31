import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getOwnerSession } from '@/lib/auth-guard';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOwnerSession(await headers());
  if (!session) redirect('/login');

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-canvas">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
