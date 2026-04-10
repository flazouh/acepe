import { env } from "$env/dynamic/private";

export function getDatabaseUrl(): string {
	const databaseUrl = env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required");
	}
	return databaseUrl;
}
