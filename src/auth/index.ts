import { database } from "@/database";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import type { Adapter } from "next-auth/adapters";

// Create a no-op adapter for build time when database is not available
const noopAdapter: Adapter = {
  createUser: async () => ({ id: "", email: "", emailVerified: null }),
  getUser: async () => null,
  getUserByEmail: async () => null,
  getUserByAccount: async () => null,
  updateUser: async () => ({ id: "", email: "", emailVerified: null }),
  deleteUser: async () => {},
  linkAccount: async () => undefined,
  unlinkAccount: async () => undefined,
  createSession: async () => ({ sessionToken: "", userId: "", expires: new Date() }),
  getSessionAndUser: async () => null,
  updateSession: async () => null,
  deleteSession: async () => {},
  createVerificationToken: async () => null,
  useVerificationToken: async () => null,
};

// Use real adapter at runtime, no-op adapter at build time
const adapter = database ? DrizzleAdapter(database) : noopAdapter;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Discord],
  adapter,
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
