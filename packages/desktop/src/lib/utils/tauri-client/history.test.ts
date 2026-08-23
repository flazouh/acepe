import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { history } from "./history.ts";

describe("history tauri client", () => {
	it("fails auditSessionLoadTiming as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(history.auditSessionLoadTiming("session-1", "/tmp/acepe", "claude-code"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails discoverAllProjectsWithSessions as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(history.discoverAllProjectsWithSessions())
		);
		expect(Result.isFailure(result)).toBe(true);
	});
});
