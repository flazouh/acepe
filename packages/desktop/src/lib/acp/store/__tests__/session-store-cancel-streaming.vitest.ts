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

	it("delegates cancel requests to the connection manager", async () => {
		const cancelStreaming = vi
			.spyOn(SessionConnectionManager.prototype, "cancelStreaming")
			.mockReturnValue(okAsync(undefined));

		const result = await store.cancelStreaming("session-123");

		expect(result.isOk()).toBe(true);
		expect(cancelStreaming).toHaveBeenCalledWith("session-123");
	});

	it("returns connection manager errors unchanged", async () => {
		const cancelError = new AgentError("cancelStreaming", new Error("network error"));
		const cancelStreaming = vi
			.spyOn(SessionConnectionManager.prototype, "cancelStreaming")
			.mockReturnValue(errAsync(cancelError));

		const result = await store.cancelStreaming("session-123");

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(cancelError);
		expect(cancelStreaming).toHaveBeenCalledWith("session-123");
	});
});
