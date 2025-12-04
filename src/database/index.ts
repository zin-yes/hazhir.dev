import { config } from "dotenv";
import { drizzle, LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client/web";

import * as schema from "@/database/schema";

config({ path: ".env" });

function createDatabase(): LibSQLDatabase<typeof schema> | null {
  const url = process.env.TURSO_CONNECTION_URL;
  if (!url) {
    // Return null during build time when env vars aren't available
    return null;
  }
  const client = createClient({
    url: url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

const db = createDatabase();

// Export database - may be null during build time
export const database: LibSQLDatabase<typeof schema> = db as LibSQLDatabase<typeof schema>;
