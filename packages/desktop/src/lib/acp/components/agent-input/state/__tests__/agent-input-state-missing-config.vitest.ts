import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

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


async function runToResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
	return Effect.runPromise(Effect.result(effect));
}

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

	it("returns a failed Effect (not throw) when projectPath is missing", async () => {
		const state = createState();

		// Must NOT throw synchronously — Effect return type is the contract.
		const resultAsync = state.sendPreparedMessage({
			content: "hello",
			selectedAgentId: "claude-code",
			projectPath: null,
		});

		const result = await runToResult(resultAsync);
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(SessionCreationError);
		}
	});

	it("returns a failed Effect (not throw) when selectedAgentId is missing", async () => {
		const state = createState();

		const resultAsync = state.sendPreparedMessage({
			content: "hello",
			selectedAgentId: null,
			projectPath: "/tmp/project",
			projectName: "Acepe",
		});

		const result = await runToResult(resultAsync);
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			const err = result.failure;
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

		const result = await runToResult(state.sendPreparedMessage({
			content: "hello",
			panelId: "panel-1",
			selectedAgentId: null,
			projectPath: "/tmp/project",
			projectName: "Acepe",
		}));

		expect(Result.isFailure(result)).toBe(true);
		expect(mockPanelStore.clearPendingUserEntry).toHaveBeenCalledWith("panel-1");
	});

	it("returns a session creation error when a deferred first prompt fails", async () => {
		const mockStore = {
			connection: {
				createSession: vi.fn(() =>
					// Claude Code can reserve a pending session before the first prompt
					// actually starts the subprocess.
					Effect.succeed({
						kind: "pending",
						sessionId: "pending-session",
						creationAttemptId: "attempt-1",
						projectPath: "/tmp/project",
						projectName: "project",
						projectColor: "#FF5D5A",
						managed: true,
						sequenceId: 1,
						agentId: "claude-code",
						title: "hello",
						worktreePath: null,
					} satisfies SessionCreationResult)
				),
				sendMessage: vi.fn(() =>
					Effect.fail(new AgentError("sendPrompt", new Error("transport unavailable")))
				),
			},
			composer: {
				beginDispatch: vi.fn(() => {}),
				endDispatch: vi.fn(() => {}),
			},
		} as unknown as SessionStore;
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

		const result = await runToResult(state.sendPreparedMessage({
			content: "hello",
			panelId: "panel-1",
			selectedAgentId: "claude-code",
			projectPath: "/tmp/project",
			projectName: "Acepe",
		}));

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(SessionCreationError);
			expect(result.failure.cause?.message).toBe("Agent operation failed: sendPrompt");
		}
		expect(mockPanelStore.clearPendingUserEntry).toHaveBeenCalledWith("panel-1");
	});
});
