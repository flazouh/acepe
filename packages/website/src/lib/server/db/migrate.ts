import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getDatabaseUrl } from "./database-url";

let migrated = false;

export async function runMigrations(): Promise<void> {
	if (migrated) return;

	const migrationClient = postgres(getDatabaseUrl(), { max: 1 });
	const db = drizzle(migrationClient);

	try {
		await migrate(db, { migrationsFolder: "./migrations" });
		migrated = true;
	} finally {
		await migrationClient.end();
	}
}
