import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth-guard";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getOwnerSession(await headers());
  if (session) redirect("/");

  const isConfigured = Boolean(
    process.env.OWNER_EMAIL?.trim() &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.BETTER_AUTH_SECRET
  );

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface border border-surface-border rounded-2xl p-8 shadow-2xl">
        <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-bold text-xl mb-6">
          D
        </div>
        <h1 className="text-2xl font-bold text-slate-50">DriveStack</h1>
        <p className="text-sm text-slate-400 mt-2 mb-8">
          Private media infrastructure. Sign in with your configured owner Google account.
        </p>
        <LoginForm isConfigured={isConfigured} />
        {!isConfigured && (
          <p className="text-xs text-amber-300 mt-5">
            Setup required: configure OWNER_EMAIL, Google OAuth credentials, BETTER_AUTH_SECRET, and BETTER_AUTH_URL in your local .env file.
          </p>
        )}
      </div>
    </main>
  );
}
