import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { AgentError } from "../../acp/errors/app-error.js";
const captureCommandFailureMock = mock(() => undefined);

mock.module("../../analytics.js", () => ({
	captureCommandFailure: captureCommandFailureMock,
}));

import { TauriCommandError, invokeAsyncWithRuntimeForTesting } from "./invoke.js";

const invokeMock = mock(async (_cmd: string, _args?: InvokeArgs) => undefined);

describe("invokeAsync", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockImplementation(async () => undefined);
		captureCommandFailureMock.mockReset();
	});

	it("preserves structured ACP errors instead of stringifying them to [object Object]", async () => {
		invokeMock.mockRejectedValueOnce({
			type: "invalid_state",
			data: {
				message:
					"OpenCode session binding mismatch: expected directory /tmp/project, got /tmp/global",
			},
		});

		const result = await invokeAsyncWithRuntimeForTesting(
			<T>(cmd: string, args?: InvokeArgs) => invokeMock(cmd, args) as Promise<T>,
			"acp_new_session"
		);

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(AgentError);
		expect(error.message).toBe("Agent operation failed: acp_new_session");
		expect(error.cause?.message).toBe(
			"Invalid state: OpenCode session binding mismatch: expected directory /tmp/project, got /tmp/global"
		);
	});

	it("parses structured command errors and preserves backend correlation metadata", async () => {
		invokeMock.mockRejectedValueOnce({
			commandName: "save_user_setting",
			classification: "unexpected",
			backendCorrelationId: "corr-123",
			backendEventId: "event-456",
			message: "Failed to save user setting",
			diagnostics: {
				summary: "database is locked",
			},
		});

		const result = await invokeAsyncWithRuntimeForTesting(
			<T>(cmd: string, args?: InvokeArgs) => invokeMock(cmd, args) as Promise<T>,
			"save_user_setting"
		);

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(TauriCommandError);
		expect(error.message).toBe("Failed to save user setting");
		expect((error as TauriCommandError).backendCorrelationId).toBe("corr-123");
		expect((error as TauriCommandError).backendEventId).toBe("event-456");
		expect(captureCommandFailureMock).toHaveBeenCalledWith(
			error,
			expect.objectContaining({
				commandName: "save_user_setting",
				invokeId: "invoke-2",
				elapsedMs: expect.any(Number),
				classification: "unexpected",
				backendCorrelationId: "corr-123",
				backendEventId: "event-456",
			})
		);
	});
});
