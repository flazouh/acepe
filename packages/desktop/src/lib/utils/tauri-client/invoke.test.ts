import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { AgentError } from "../../acp/errors/app-error.js";
import { invokeAsync } from "./invoke.js";

type InvokeMock = typeof invoke & {
	mockReset: () => void;
	mockRejectedValue: (value: object) => void;
};

const invokeMock = invoke as InvokeMock;

describe("invokeAsync", () => {
	beforeEach(() => {
		invokeMock.mockReset();
	});

	it("preserves structured ACP errors instead of stringifying them to [object Object]", async () => {
		invokeMock.mockRejectedValue({
			type: "invalid_state",
			data: {
				message:
					"OpenCode session binding mismatch: expected directory /tmp/project, got /tmp/global",
			},
		});

		const result = await invokeAsync("acp_new_session");

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(AgentError);
		expect(error.message).toBe("Agent operation failed: acp_new_session");
		expect(error.cause?.message).toBe(
			"Invalid state: OpenCode session binding mismatch: expected directory /tmp/project, got /tmp/global"
		);
	});
});
