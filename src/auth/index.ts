import { database } from "@/database";
import * as schema from "@/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../../env.js";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_BASE_URL,
  database: drizzleAdapter(database, {
    provider: "sqlite",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: env.BETTER_AUTH_GOOGLE_CLIENT_ID as string,
      clientSecret: env.BETTER_AUTH_GOOGLE_CLIENT_SECRET as string,
    },
  },
});
