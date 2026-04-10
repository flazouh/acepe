import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { AgentError } from "../../acp/errors/app-error.js";
import { invokeAsyncWithRuntimeForTesting } from "./invoke.js";

const invokeMock = mock(async (_cmd: string, _args?: InvokeArgs) => undefined);

describe("invokeAsync", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockImplementation(async () => undefined);
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
});
