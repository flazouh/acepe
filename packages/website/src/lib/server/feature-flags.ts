import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import postgres from "postgres";
import { getDatabaseUrl } from "./db/database-url";
import * as schema from "./db/schema";
import { type FeatureFlagName, featureFlags } from "./db/schema";

export type FeatureFlags = {
	loginEnabled: boolean;
	downloadEnabled: boolean;
	roadmapEnabled: boolean;
};

const FLAG_DEFAULTS: Record<FeatureFlagName, boolean> = {
	login_enabled: false,
	download_enabled: false,
	roadmap_enabled: false,
};

function withFeatureFlagDb<T>(operation: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): ResultAsync<T, Error> {
	return ResultAsync.fromPromise(
		(async () => {
			const client = postgres(getDatabaseUrl(), { max: 1 });
			const db = drizzle(client, { schema });

			return operation(db).finally(async () => {
				await client.end();
			});
		})(),
		(error) => new Error(`Feature flag database access failed: ${error}`)
	);
}

function getOrCreateFlag(name: FeatureFlagName): ResultAsync<boolean, Error> {
	return withFeatureFlagDb(async (db) => {
			const rows = await db.select().from(featureFlags).where(eq(featureFlags.name, name));

			if (rows.length > 0) {
				return rows[0].enabled;
			}

			// Auto-seed with default value
			const defaultValue = FLAG_DEFAULTS[name];
			await db
				.insert(featureFlags)
				.values({ name, enabled: defaultValue, updatedAt: new Date() })
				.onConflictDoNothing();

			return defaultValue;
	}).mapErr((error) => new Error(`Failed to get feature flag ${name}: ${error}`));
}

export function getFeatureFlags(): ResultAsync<FeatureFlags, Error> {
	return ResultAsync.combine([
		getOrCreateFlag("login_enabled"),
		getOrCreateFlag("download_enabled"),
		getOrCreateFlag("roadmap_enabled"),
	]).map(([loginEnabled, downloadEnabled, roadmapEnabled]) => ({
		loginEnabled,
		downloadEnabled,
		roadmapEnabled,
	}));
}

export function setFeatureFlag(name: FeatureFlagName, enabled: boolean): ResultAsync<void, Error> {
	return withFeatureFlagDb((db) =>
		db
			.insert(featureFlags)
			.values({ name, enabled, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: featureFlags.name,
				set: { enabled, updatedAt: new Date() },
			})
	)
		.map(() => undefined)
		.mapErr((error) => new Error(`Failed to set feature flag ${name}: ${error}`));
}
