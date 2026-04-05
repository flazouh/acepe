import { errAsync, okAsync } from "neverthrow";
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
			okAsync(undefined)
		);

		const result = await store.cancelStreaming("session-123");

		expect(result.isOk()).toBe(true);
		expect(onTurnInterrupted).toHaveBeenCalledWith("session-123");
	});

	it("does not notify interruption callbacks when cancel fails", async () => {
		const onTurnInterrupted = vi.fn();
		store.setCallbacks({ onTurnInterrupted });

		vi.spyOn(SessionConnectionManager.prototype, "cancelStreaming").mockReturnValue(
			errAsync(new AgentError("cancelStreaming", new Error("network error")))
		);

		const result = await store.cancelStreaming("session-123");

		expect(result.isErr()).toBe(true);
		expect(onTurnInterrupted).not.toHaveBeenCalled();
	});
});
