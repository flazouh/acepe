import { describe, expect, it, vi } from "vitest";
import { errAsync, okAsync } from "neverthrow";

import { AgentError } from "../../../../errors/app-error.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type {
	SessionCreationResult,
	SessionStore,
} from "../../../../store/session-store.svelte.js";
import { DEFAULT_PANEL_HOT_STATE } from "../../../../store/types.js";
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

	it("clears a pre-session pending user entry when selectedAgentId is missing", async () => {
		const mockStore: Partial<SessionStore> = {};
		const mockPanelStore: Partial<PanelStore> = {
			clearPendingUserEntry: vi.fn(),
		};
		const state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);

		const result = await state.sendPreparedMessage({
			content: "hello",
			panelId: "panel-1",
			selectedAgentId: null,
			projectPath: "/tmp/project",
			projectName: "Acepe",
		});

		expect(result.isErr()).toBe(true);
		expect(mockPanelStore.clearPendingUserEntry).toHaveBeenCalledWith("panel-1");
	});

	it("returns a session creation error when a deferred first prompt fails", async () => {
		const mockStore: Partial<SessionStore> = {
			createSession: vi.fn(() =>
				// Claude Code can reserve a pending session before the first prompt
				// actually starts the subprocess.
				okAsync({
					kind: "pending",
					sessionId: "pending-session",
					creationAttemptId: "attempt-1",
					projectPath: "/tmp/project",
					agentId: "claude-code",
					title: "hello",
					worktreePath: null,
				} satisfies SessionCreationResult)
			),
			sendMessage: vi.fn(() =>
				errAsync(new AgentError("sendPrompt", new Error("transport unavailable")))
			),
		};
		const mockPanelStore: Partial<PanelStore> = {
			getHotState: vi.fn(() => DEFAULT_PANEL_HOT_STATE),
			setPendingUserEntry: vi.fn(),
			clearPendingUserEntry: vi.fn(),
		};
		const state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);

		const result = await state.sendPreparedMessage({
			content: "hello",
			panelId: "panel-1",
			selectedAgentId: "claude-code",
			projectPath: "/tmp/project",
			projectName: "Acepe",
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(SessionCreationError);
			expect(result.error.cause?.message).toBe("Agent operation failed: sendPrompt");
		}
		expect(mockPanelStore.clearPendingUserEntry).toHaveBeenCalledWith("panel-1");
	});
});
