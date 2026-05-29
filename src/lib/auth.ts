// Dev-only: simple user context for MVP.
// Replace with NextAuth before production.
import { prisma } from "./prisma";

let devUserId: string | null = null;

export async function getCurrentUserId(): Promise<string> {
  // In production, get user from session. For dev, use a default user.
  if (!devUserId) {
    const user = await prisma.user.upsert({
      where: { email: "dev@noteflow.local" },
      update: {},
      create: { email: "dev@noteflow.local", name: "Dev User" },
    });
    devUserId = user.id;
  }
  return devUserId;
}
