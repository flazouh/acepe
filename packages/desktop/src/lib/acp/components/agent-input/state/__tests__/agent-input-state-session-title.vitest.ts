import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { SessionCold } from "../../../../application/dto/session-cold.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { DEFAULT_PANEL_HOT_STATE } from "../../../../store/types.js";
import { AgentInputState } from "../agent-input-state.svelte.js";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async () => () => {}),
}));

describe("AgentInputState - initial session title", () => {
	it("uses the first user prompt as the created session title", async () => {
		const createdSession: SessionCold = {
			id: "session-123",
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Build kanban parity",
			updatedAt: new Date(),
			createdAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		};
		const createSession = vi.fn(() => okAsync({ kind: "ready" as const, session: createdSession }));
		const sendMessage = vi.fn(() => okAsync(undefined));
		const getSessionCold = vi.fn(() => createdSession);
		const mockStore = {
			connection: {
				createSession,
				sendMessage,
			},
			read: {
				getSessionCold,
			},
			composer: {
				beginDispatch: vi.fn(() => {}),
				endDispatch: vi.fn(() => {}),
			},
		} as unknown as SessionStore;
		const mockPanelStore: Partial<PanelStore> = {};
		const state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);

		const result = await state.sendPreparedMessage({
			content: "Build kanban parity\n\nShow the title immediately.",
			projectPath: "/tmp/project",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		expect(createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "claude-code",
				projectPath: "/tmp/project",
				title: "Build kanban parity",
			})
		);
		expect(sendMessage).toHaveBeenCalledWith(
			"session-123",
			"Build kanban parity\n\nShow the title immediately.",
			[]
		);
	});

	it("keeps the pending first-send entry through session attachment until send succeeds", async () => {
		const events: string[] = [];
		const createdSession: SessionCold = {
			id: "session-123",
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Build kanban parity",
			updatedAt: new Date(),
			createdAt: new Date(),
			sessionLifecycleState: "created",
			parentId: null,
		};
		const createSession = vi.fn(() => okAsync({ kind: "ready" as const, session: createdSession }));
		const sendMessage = vi.fn(() => {
			events.push("send-message");
			return okAsync(undefined);
		});
		const getSessionCold = vi.fn(() => createdSession);
		const mockStore = {
			connection: {
				createSession,
				sendMessage,
			},
			read: {
				getSessionCold,
			},
			composer: {
				beginDispatch: vi.fn(() => {}),
				endDispatch: vi.fn(() => {}),
			},
		} as unknown as SessionStore;
		const mockPanelStore: Partial<PanelStore> = {
			getHotState: vi.fn(() =>
				Object.assign({}, DEFAULT_PANEL_HOT_STATE, {
					pendingUserEntry: null,
				})
			),
			setPendingUserEntry: vi.fn(() => {
				events.push("set-pending");
			}),
			clearPendingUserEntry: vi.fn(() => {
				events.push("clear-pending");
			}),
		};
		const state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);

		const result = await state.sendPreparedMessage({
			content: "Build kanban parity",
			panelId: "panel-1",
			projectPath: "/tmp/project",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
			onSessionCreated: () => {
				events.push("session-created");
			},
		});

		expect(result.isOk()).toBe(true);
		expect(events).toEqual(["set-pending", "session-created", "send-message", "clear-pending"]);
	});

	it("sends the first message through a deferred creation handle without requiring a cold session", async () => {
		const createSession = vi.fn(() =>
			okAsync({
				kind: "pending" as const,
				sessionId: "provider-requested-id",
				creationAttemptId: "attempt-1",
				projectPath: "/tmp/project",
				agentId: "claude-code",
				title: "Build stable panels",
				worktreePath: null,
			})
		);
		const sendMessage = vi.fn(() => okAsync(undefined));
		const onSessionCreated = vi.fn();
		const mockStore = {
			connection: {
				createSession,
				sendMessage,
			},
			read: {
				getSessionCold: vi.fn(() => undefined),
			},
			composer: {
				beginDispatch: vi.fn(() => {}),
				endDispatch: vi.fn(() => {}),
			},
		} as unknown as SessionStore;
		const mockPanelStore: Partial<PanelStore> = {
			getHotState: vi.fn(() =>
				Object.assign({}, DEFAULT_PANEL_HOT_STATE, {
					pendingUserEntry: null,
				})
			),
			setPendingUserEntry: vi.fn(() => {}),
			clearPendingUserEntry: vi.fn(() => {}),
		};
		const state = new AgentInputState(
			mockStore as SessionStore,
			mockPanelStore as PanelStore,
			() => "/tmp/project"
		);

		const result = await state.sendPreparedMessage({
			content: "Build stable panels",
			panelId: "panel-1",
			projectPath: "/tmp/project",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
			onSessionCreated,
		});

		expect(result.isOk()).toBe(true);
		expect(onSessionCreated).toHaveBeenCalledWith("provider-requested-id", "panel-1");
		expect(sendMessage).toHaveBeenCalledWith("provider-requested-id", "Build stable panels", []);
	});
});
