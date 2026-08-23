import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { terminal } from "./terminal.ts";

// This facade covers the ACP tool-call terminal (terminal/create,
// terminal/output, terminal/wait_for_exit, terminal/kill, terminal/release):
// a run-and-capture concept the contract does not carry yet, and every
// method has zero live callers today (see the comment on ./terminal.ts).
// These tests only pin the "unsupported on the contract" behavior so the
// facade fails loudly instead of silently reaching for a removed Tauri
// client if a caller ever shows up.
describe("terminal tauri client", () => {
	it("fails create as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(terminal.create({ sessionId: "session-1", command: "echo hi" }))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails output as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(terminal.output("session-1", "terminal-1"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails waitForExit as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(terminal.waitForExit("session-1", "terminal-1"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails kill as unsupported on the contract", async () => {
		const result = await Effect.runPromise(Effect.result(terminal.kill("session-1", "terminal-1")));
		expect(Result.isFailure(result)).toBe(true);
	});

	it("fails release as unsupported on the contract", async () => {
		const result = await Effect.runPromise(
			Effect.result(terminal.release("session-1", "terminal-1"))
		);
		expect(Result.isFailure(result)).toBe(true);
	});
});
