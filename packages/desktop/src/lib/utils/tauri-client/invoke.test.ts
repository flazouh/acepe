import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { AgentError } from "../../acp/errors/app-error.js";

const captureCommandFailureMock = mock(() => undefined);

mock.module("../../analytics.js", () => ({
	captureCommandFailure: captureCommandFailureMock,
}));

import {
	getTauriInvokeTimings,
	invokeAsyncWithRuntimeForTesting,
	resetTauriInvokeTimingsForTesting,
	TauriCommandError,
} from "./invoke.js";
import { CMD } from "./commands.js";

const invokeMock = mock(async (_cmd: string, _args?: InvokeArgs) => undefined);

async function flushDynamicImports(): Promise<void> {
	await Promise.resolve();
	await Bun.sleep(0);
}

describe("invokeAsync", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockImplementation(async () => undefined);
		captureCommandFailureMock.mockReset();
		resetTauriInvokeTimingsForTesting();
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
		await flushDynamicImports();
		expect(captureCommandFailureMock).toHaveBeenCalledWith(
			error,
			expect.objectContaining({
				commandName: "save_user_setting",
				invokeId: expect.stringMatching(/^invoke-\d+$/),
				elapsedMs: expect.any(Number),
				referenceId: "corr-123",
				referenceSearchable: true,
				classification: "unexpected",
				backendCorrelationId: "corr-123",
				backendEventId: "event-456",
				diagnosticsSummary: "database is locked",
			})
		);
	});

	it("can keep best-effort invoke failures out of command failure telemetry", async () => {
		invokeMock.mockRejectedValueOnce("notification plugin failed");

		const result = await invokeAsyncWithRuntimeForTesting(
			<T>(cmd: string, args?: InvokeArgs) => invokeMock(cmd, args) as Promise<T>,
			CMD.notifications.send,
			{ options: { title: "Task Complete", body: "Agent finished work" } },
			{ reportFailure: false }
		);

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(AgentError);
		expect(error.message).toBe("Agent operation failed: plugin:notification|notify");
		expect(captureCommandFailureMock).not.toHaveBeenCalled();
	});

	it("records completed invoke timings for performance probes", async () => {
		const successResult = await invokeAsyncWithRuntimeForTesting(
			<T>(_cmd: string, _args?: InvokeArgs) => Promise.resolve("ok" as T),
			"fast_command"
		);
		const failureResult = await invokeAsyncWithRuntimeForTesting(
			<T>(_cmd: string, _args?: InvokeArgs) => Promise.reject("boom") as Promise<T>,
			"failing_command",
			undefined,
			{ reportFailure: false }
		);

		expect(successResult.isOk()).toBe(true);
		expect(failureResult.isErr()).toBe(true);
		expect(getTauriInvokeTimings()).toEqual([
			expect.objectContaining({
				command: "fast_command",
				status: "ok",
				durationMs: expect.any(Number),
			}),
			expect.objectContaining({
				command: "failing_command",
				status: "error",
				durationMs: expect.any(Number),
			}),
		]);
	});

	it("summarizes get_user_settings keys for startup performance probes", async () => {
		const result = await invokeAsyncWithRuntimeForTesting(
			<T>(_cmd: string, _args?: InvokeArgs) => Promise.resolve([] as T),
			"get_user_settings",
			{ keys: ["user_theme", "zoom_level"] }
		);

		expect(result.isOk()).toBe(true);
		expect(getTauriInvokeTimings()).toEqual([
			expect.objectContaining({
				command: "get_user_settings",
				argsSummary: "user_theme,zoom_level",
			}),
		]);
	});
});
