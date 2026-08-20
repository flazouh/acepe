import { fromPromise } from "@acepe/effect-result/fromPromise";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as Effect from "effect/Effect";
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

function withFeatureFlagDb<T>(
	operation: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Effect.Effect<T, Error> {
	return fromPromise(
		() => {
			const client = postgres(getDatabaseUrl(), { max: 1 });
			const db = drizzle(client, { schema });

			return operation(db).finally(() => client.end());
		},
		(error) => new Error(`Feature flag database access failed: ${error}`)
	);
}

function getOrCreateFlag(name: FeatureFlagName): Effect.Effect<boolean, Error> {
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
	}).pipe(
		Effect.mapError((error) => new Error(`Failed to get feature flag ${name}: ${error}`))
	);
}

export function getFeatureFlags(): Effect.Effect<FeatureFlags, Error> {
	return Effect.all(
		[
			getOrCreateFlag("login_enabled"),
			getOrCreateFlag("download_enabled"),
			getOrCreateFlag("roadmap_enabled"),
		],
		{ concurrency: 3 }
	).pipe(
		Effect.map(([loginEnabled, downloadEnabled, roadmapEnabled]) => ({
			loginEnabled,
			downloadEnabled,
			roadmapEnabled,
		}))
	);
}

export function setFeatureFlag(name: FeatureFlagName, enabled: boolean): Effect.Effect<void, Error> {
	return withFeatureFlagDb((db) =>
		db
			.insert(featureFlags)
			.values({ name, enabled, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: featureFlags.name,
				set: { enabled, updatedAt: new Date() },
			})
	).pipe(
		Effect.asVoid,
		Effect.mapError((error) => new Error(`Failed to set feature flag ${name}: ${error}`))
	);
}
