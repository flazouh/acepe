import { afterEach, describe, expect, it, vi } from "vitest";

import { load } from "./+layout.server";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
	if (originalDatabaseUrl === undefined) {
		delete process.env.DATABASE_URL;
	} else {
		process.env.DATABASE_URL = originalDatabaseUrl;
	}

	vi.restoreAllMocks();
});

describe("root layout server load", () => {
	it("falls back to default feature flags when the database is unavailable", async () => {
		process.env.DATABASE_URL = "postgres://acepe:wrong@127.0.0.1:1/acepe";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
			})
		);

		const result = await load({
			url: new URL("https://acepe.dev/"),
		} as never);

		expect(result).toBeDefined();

		if (result === undefined) {
			throw new Error("Expected layout load to return fallback data");
		}

		expect(result.featureFlags).toEqual({
			loginEnabled: false,
			downloadEnabled: true,
			roadmapEnabled: false,
		});
		expect(result.githubStars).toBeNull();
	});
});
