import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getOwnerSession(requestHeaders: Headers) {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return null;

  const session = await auth.api.getSession({ headers: requestHeaders });
  const sessionEmail = session?.user.email?.trim().toLowerCase();

  if (!session || !sessionEmail || sessionEmail !== ownerEmail) {
    return null;
  }

  // Claim any pre-authentication Drive accounts for the sole configured owner.
  // This is idempotent and never overwrites an account already owned by someone.
  await db.googleAccount.updateMany({
    where: { ownerUserId: null },
    data: { ownerUserId: session.user.id },
  });

  return session;
}
