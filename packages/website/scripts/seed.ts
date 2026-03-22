import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { featureFlags, featureFlagEnum } from '../src/lib/server/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
	console.error('DATABASE_URL is required');
	process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const FLAG_DEFAULTS: Record<(typeof featureFlagEnum.enumValues)[number], boolean> = {
	login_enabled: true
};

async function seed() {
	console.log('Seeding feature flags...');

	for (const [name, enabled] of Object.entries(FLAG_DEFAULTS)) {
		await db
			.insert(featureFlags)
			.values({
				name: name as (typeof featureFlagEnum.enumValues)[number],
				enabled,
				updatedAt: new Date()
			})
			.onConflictDoNothing();

		console.log(`  - ${name}: ${enabled}`);
	}

	console.log('Done!');
	await client.end();
}

seed().catch((err) => {
	console.error('Failed to seed:', err);
	process.exit(1);
});
