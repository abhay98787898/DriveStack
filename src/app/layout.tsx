import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DriveStack - Personal Media Cloud & API Gateway',
  description: 'A private, Google Drive-powered media management and delivery platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-canvas text-slate-50 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
