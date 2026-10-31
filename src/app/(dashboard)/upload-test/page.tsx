'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, CheckCircle2, AlertCircle, File, ExternalLink } from 'lucide-react';

interface UploadResult {
  success: boolean;
  name?: string;
  mime_type?: string;
  url?: string;
  error?: string;
}

export default function UploadTestPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [folder, setFolder] = useState('uploads/test');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to upload');
      return;
    }
    if (!apiKey.trim()) {
      setError('Please provide an API Key. Generate one from the API Keys tab.');
      return;
    }

    setUploading(true);
    setProgress(15);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (folder.trim()) {
        formData.append('folder', folder.trim());
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey.trim()}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(95, Math.round((event.loaded / event.total) * 95));
          setProgress(percent);
        }
      };

      xhr.onload = () => {
        setUploading(false);
        try {
          const data = JSON.parse(xhr.responseText) as UploadResult;
          if (xhr.status >= 200 && xhr.status < 300 && data.success) {
            setProgress(100);
            setResult(data);
            router.refresh();
          } else {
            setError(data.error || `Upload failed with status ${xhr.status}`);
          }
        } catch {
          setError('Failed to parse server upload response');
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setError('Network error connecting to Driveinary server');
      };

      xhr.send(formData);
    } catch (err: unknown) {
      setUploading(false);
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during upload'
      );
    }
  };

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-5xl mx-auto space-y-3 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-base sm:text-2xl font-bold tracking-tight text-slate-50">Upload Test Bench</h1>
        <p className="text-[11px] sm:text-sm text-slate-400 mt-0.5">
          Interactive playground to test multipart stream uploads directly to Google Drive and verify immediate proxy delivery.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
        {/* Upload Form */}
        <form onSubmit={handleUpload} className="space-y-3 sm:space-y-4 bg-surface border border-surface-border rounded-xl p-3 sm:p-5">
          <h3 className="font-semibold text-xs sm:text-sm text-slate-100">Upload Parameters</h3>

          {/* API Key Input & Quick Selector */}
          <div>
            <label className="block text-[11px] sm:text-xs font-semibold text-slate-300 mb-1.5">
              API Key (Bearer Token)
            </label>
            <p className="text-[10px] text-slate-500 mb-1.5">
              Paste the API key you saved when it was created. For security, existing keys cannot be retrieved from this page.
            </p>

            <input
              type="text"
              required
              placeholder="drv_live_xxxxxxxxxxxxxxxx"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-canvas border border-surface-border rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Target Folder */}
          <div>
            <label className="block text-[11px] sm:text-xs font-semibold text-slate-300 mb-1">
              Target Folder in Google Drive (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. products/summer2026"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full bg-canvas border border-surface-border rounded-md px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Dropzone */}
          <div>
            <label className="block text-[11px] sm:text-xs font-semibold text-slate-300 mb-1">
              Select Media File
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-surface-border hover:border-primary/60 rounded-xl p-3.5 sm:p-5 text-center cursor-pointer transition-colors bg-canvas/60"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
              />
              <UploadCloud className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400 mx-auto mb-1" />
              {file ? (
                <div>
                  <p className="text-xs font-semibold text-primary truncate max-w-xs mx-auto">
                    {file.name}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                    {(file.size / 1024).toFixed(1)} KB — {file.type || 'unknown type'}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-slate-300">Click to choose or drag & drop</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Photos, Videos, or Documents (up to 500 MB)</p>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {uploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Streaming to Google Drive...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-surface-border h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 flex items-start gap-2 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full h-8 sm:h-10 rounded-md bg-primary hover:bg-primary-hover active:scale-95 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-primary/20"
          >
            {uploading ? 'Uploading...' : 'Send Multipart Request'}
          </button>
        </form>

        {/* Live Response Inspector */}
        <div className="bg-surface border border-surface-border rounded-xl p-3 sm:p-5 flex flex-col justify-between space-y-3">
          <div>
            <h3 className="font-semibold text-xs sm:text-sm text-slate-100 mb-1">Live Response Inspector</h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Direct verification of the server response and streamed media preview.
            </p>

            {result ? (
              <div className="mt-3 space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Asset Uploaded & Ready
                </div>

                {/* Rendered Asset Preview */}
                <div className="bg-canvas border border-surface-border rounded-lg overflow-hidden flex items-center justify-center min-h-[140px] max-h-[180px]">
                  {result.mime_type?.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.url}
                      alt={result.name}
                      className="max-h-[160px] w-auto object-contain"
                    />
                  ) : result.mime_type?.startsWith('video/') ? (
                    <video controls className="max-h-[160px] w-full">
                      <source src={result.url} type={result.mime_type} />
                    </video>
                  ) : (
                    <div className="text-center py-4 text-slate-400">
                      <File className="w-8 h-8 mx-auto mb-1 text-slate-500" />
                      <span className="text-xs">{result.name}</span>
                    </div>
                  )}
                </div>

                {/* Direct Link Anchor */}
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline font-mono inline-flex items-center gap-1"
                >
                  {result.url} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <div className="mt-3 border border-dashed border-surface-border rounded-lg p-6 sm:p-8 text-center bg-canvas/30">
                <p className="text-xs text-slate-400">Awaiting upload payload...</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  JSON attributes & direct media link will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
