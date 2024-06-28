import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { database } from "./database";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Discord],
  adapter: DrizzleAdapter(database),
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    }
  }
});
