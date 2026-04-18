import { describe, expect, it, vi } from "vitest";

import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { SessionCreationError } from "../../errors/agent-input-error.js";
import { AgentInputState } from "../agent-input-state.svelte.js";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async () => () => {}),
}));

describe("AgentInputState - sendPreparedMessage input guards", () => {
	function createState(): AgentInputState {
		const mockStore: Partial<SessionStore> = {};
		const mockPanelStore: Partial<PanelStore> = {};
		return new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);
	}

	it("returns errAsync (not throw) when projectPath is missing", async () => {
		const state = createState();

		// Must NOT throw synchronously — ResultAsync return type is the contract.
		const resultAsync = state.sendPreparedMessage({
			content: "hello",
			selectedAgentId: "claude-code",
			projectPath: null,
		});

		const result = await resultAsync;
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(SessionCreationError);
		}
	});

	it("returns errAsync (not throw) when selectedAgentId is missing", async () => {
		const state = createState();

		const resultAsync = state.sendPreparedMessage({
			content: "hello",
			selectedAgentId: null,
			projectPath: "/tmp/project",
			projectName: "Acepe",
		});

		const result = await resultAsync;
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			const err = result.error;
			expect(err).toBeInstanceOf(SessionCreationError);
			expect(err).toMatchObject({ agentId: "unknown" });
		}
	});
});
