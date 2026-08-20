import { afterEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { getFeatureFlags } from "./feature-flags";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
	if (originalDatabaseUrl === undefined) {
		delete process.env.DATABASE_URL;
		return;
	}

	process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("feature flag loading", () => {
	it("returns an error result instead of throwing when DATABASE_URL is missing", async () => {
		delete process.env.DATABASE_URL;

		const result = await Effect.runPromise(Effect.result(getFeatureFlags()));

		expect(Result.isFailure(result)).toBe(true);
	});

	it("returns an error result instead of crashing when the database is unreachable", async () => {
		process.env.DATABASE_URL = "postgres://acepe:wrong@127.0.0.1:1/acepe";

		const result = await Effect.runPromise(Effect.result(getFeatureFlags()));

		expect(Result.isFailure(result)).toBe(true);
	});
});
