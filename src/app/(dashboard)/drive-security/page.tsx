'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

type PermissionResult = {
  assetId: string;
  name: string;
  accountEmail?: string;
  publicPermissionCount?: number;
  revokedCount?: number;
  error?: string;
};

type ScanSummary = {
  processed: number;
  publicFiles: number;
  publicPermissions: number;
  errors: number;
  results: PermissionResult[];
};

async function scanAll(action: 'audit' | 'revoke'): Promise<ScanSummary> {
  let cursor: string | undefined;
  const summary: ScanSummary = { processed: 0, publicFiles: 0, publicPermissions: 0, errors: 0, results: [] };

  do {
    const response = await fetch('/api/drive-permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        ...(action === 'revoke' ? { confirmation: 'REVOKE_PUBLIC_LINKS' } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || `Permission ${action} failed`);

    summary.processed += Number(data.processed || 0);
    for (const item of (data.results || []) as PermissionResult[]) {
      summary.results.push(item);
      if (item.error) summary.errors += 1;
      summary.publicPermissions += action === 'audit' ? Number(item.publicPermissionCount || 0) : Number(item.revokedCount || 0);
      if (item.publicPermissionCount || item.revokedCount) summary.publicFiles += 1;
    }
    cursor = data.nextCursor || undefined;
  } while (cursor);

  return summary;
}

export default function DriveSecurityPage() {
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<ScanSummary | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const runAudit = async () => {
    setBusy(true);
    setError('');
    setMessage('Scanning images in your connected DriveStack media folders and checking Google Drive permissions...');
    setAudit(null);
    try {
      const result = await scanAll('audit');
      setAudit(result);
      setMessage('Audit complete. Review the results before choosing whether to revoke public links.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const runRevoke = async () => {
    if (!audit || audit.errors > 0 || audit.publicPermissions === 0) return;
    const confirmed = window.confirm(
      `Remove ${audit.publicPermissions} public link permission(s) from ${audit.publicFiles} verified DriveStack file(s)?\n\nFiles will NOT be deleted. Their branded DriveStack media URLs will continue to work.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('Removing only public-link permissions from verified DriveStack media files...');
    try {
      const result = await scanAll('revoke');
      setAudit({ ...result, publicFiles: result.publicFiles, publicPermissions: result.publicPermissions });
      setMessage('Permission cleanup finished. Run a fresh audit to verify that no public links remain.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Permission cleanup failed');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary mb-2"><ShieldCheck className="w-5 h-5" /><span className="text-xs font-semibold uppercase tracking-wider">Security</span></div>
        <h1 className="text-2xl font-bold text-slate-50">Google Drive Permissions</h1>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl">Audit public-link permissions on images in connected DriveStack media folders and their direct subfolders. Cleanup removes only <code>anyone</code> permissions; it never deletes your files or changes user-specific sharing.</p>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" /><div><h2 className="font-semibold text-slate-100">Review before cleanup</h2><p className="text-sm text-slate-400 mt-1">Removing public-link access means Google Drive links shared elsewhere may stop working. DriveStack media URLs are served through your connected account and are designed to continue working.</p></div></div>
        <div className="flex flex-wrap gap-3">
          <button onClick={runAudit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Run full audit</button>
          <button onClick={runRevoke} disabled={busy || !audit || audit.errors > 0 || audit.publicPermissions === 0} className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-40">Revoke audited public links</button>
        </div>
        {message && <p className="text-sm text-slate-300">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </div>

      {audit && <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Images scanned" value={audit.processed} />
          <Metric label="Files with public links" value={audit.publicFiles} />
          <Metric label="Public permissions" value={audit.publicPermissions} />
          <Metric label="Errors" value={audit.errors} />
        </div>
        {audit.errors > 0 && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">Some files could not be checked. Cleanup is disabled until the audit completes without errors.</p>}
        {audit.results.length > 0 && <div className="rounded-xl border border-surface-border overflow-hidden"><div className="p-4 border-b border-surface-border font-semibold text-slate-100">Audit details</div><div className="divide-y divide-surface-border">{audit.results.map((item) => <div key={item.assetId} className="p-3 sm:p-4 flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-100 truncate">{item.name}</p><p className="text-xs text-slate-500 mt-1">Drive file ID: {item.assetId}{item.accountEmail ? ` · ${item.accountEmail}` : ''}</p>{item.error && <p className="text-xs text-red-300 mt-1">{item.error}</p>}</div><span className="text-xs text-slate-300 shrink-0">{item.publicPermissionCount ? `${item.publicPermissionCount} public` : item.revokedCount ? `${item.revokedCount} revoked` : item.error ? 'Error' : 'Checked'}</span></div>)}</div></div>}
        {audit.errors === 0 && audit.publicPermissions === 0 && <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="w-4 h-4" /> No public-link permissions found in the scanned DriveStack images.</p>}
      </div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-surface-border bg-surface p-3 sm:p-4"><p className="text-xs text-slate-400">{label}</p><p className="text-2xl font-bold text-slate-50 mt-1 tabular-nums">{value}</p></div>;
}
