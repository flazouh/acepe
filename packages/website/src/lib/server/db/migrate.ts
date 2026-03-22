import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

let migrated = false;

export async function runMigrations(): Promise<void> {
	if (migrated) return;

	const migrationClient = postgres(env.DATABASE_URL!, { max: 1 });
	const db = drizzle(migrationClient);

	try {
		await migrate(db, { migrationsFolder: './migrations' });
		migrated = true;
	} finally {
		await migrationClient.end();
	}
}
