import { betterAuth } from "better-auth";
import { env } from "../../env.js";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_BASE_URL,
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
