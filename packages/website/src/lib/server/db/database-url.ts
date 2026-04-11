import { env } from "$env/dynamic/private";

export function maybeGetDatabaseUrl(): string | null {
	return env.DATABASE_URL ?? null;
}

export function getDatabaseUrl(): string {
	const databaseUrl = maybeGetDatabaseUrl();
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required");
	}
	return databaseUrl;
}
