import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "../../errors/app-error.js";
import { SessionConnectionManager } from "../services/session-connection-manager.js";
import { SessionStore } from "../session-store.svelte.js";

describe("SessionStore cancelStreaming", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("notifies interruption callbacks after a successful cancel", async () => {
		const onTurnInterrupted = vi.fn();
		store.setCallbacks({ onTurnInterrupted });

		vi.spyOn(SessionConnectionManager.prototype, "cancelStreaming").mockReturnValue(
			Effect.succeed(undefined)
		);

		const result = await Effect.runPromise(Effect.result(store.connection.cancelStreaming("session-123")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(onTurnInterrupted).toHaveBeenCalledWith("session-123");
	});

	it("does not notify interruption callbacks when cancel fails", async () => {
		const onTurnInterrupted = vi.fn();
		store.setCallbacks({ onTurnInterrupted });

		vi.spyOn(SessionConnectionManager.prototype, "cancelStreaming").mockReturnValue(
			Effect.fail(new AgentError("cancelStreaming", new Error("network error")))
		);

		const result = await Effect.runPromise(Effect.result(store.connection.cancelStreaming("session-123")));

		expect(Result.isFailure(result)).toBe(true);
		expect(onTurnInterrupted).not.toHaveBeenCalled();
	});
});
