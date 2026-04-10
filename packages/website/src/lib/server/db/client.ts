import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "./database-url";
import * as schema from "./schema";

const client = postgres(getDatabaseUrl());
export const db = drizzle(client, { schema });
