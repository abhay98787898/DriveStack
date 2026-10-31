"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ isConfigured }: { isConfigured: boolean }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setError("");
    setIsLoading(true);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });

      if (result.error) {
        setError("Sign-in failed. Check the owner email and Google OAuth configuration.");
        setIsLoading(false);
      }
    } catch {
      setError("Unable to start Google sign-in. Please try again.");
      setIsLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={!isConfigured || isLoading}
        className="w-full min-h-11 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
      >
        {isLoading ? "Connecting to Google..." : "Continue with Google"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400 mt-4">
          {error}
        </p>
      )}
    </div>
  );
}
