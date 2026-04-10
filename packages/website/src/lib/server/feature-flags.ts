import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { db } from "./db/client";
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

function getOrCreateFlag(name: FeatureFlagName): ResultAsync<boolean, Error> {
	return ResultAsync.fromPromise(
		(async () => {
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
		})(),
		(error) => new Error(`Failed to get feature flag ${name}: ${error}`)
	);
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
	return ResultAsync.fromPromise(
		db
			.insert(featureFlags)
			.values({ name, enabled, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: featureFlags.name,
				set: { enabled, updatedAt: new Date() },
			}),
		(error) => new Error(`Failed to set feature flag ${name}: ${error}`)
	).map(() => undefined);
}
