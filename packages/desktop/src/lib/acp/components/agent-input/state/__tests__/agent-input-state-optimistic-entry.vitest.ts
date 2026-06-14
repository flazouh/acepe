import { beforeEach, describe, expect, it, vi } from "vitest";
import { errAsync, okAsync } from "neverthrow";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async () => () => {}),
}));

import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { DEFAULT_PANEL_HOT_STATE } from "../../../../store/types.js";
import { SessionCreationError } from "../../errors/agent-input-error.js";
import { AgentInputState } from "../agent-input-state.svelte.js";

function makeSession(id: string = "session-123") {
	return {
		id,
		projectPath: "/repo",
		agentId: "claude-code",
		title: "Test session",
		updatedAt: new Date(),
		createdAt: new Date(),
		sessionLifecycleState: "created" as const,
		parentId: null,
	};
}

function makePanelStore(input?: {
	readonly pendingUserEntry?: SessionEntry | null;
}): {
	readonly store: Partial<PanelStore>;
	readonly setPendingUserEntry: ReturnType<typeof vi.fn>;
	readonly clearPendingUserEntry: ReturnType<typeof vi.fn>;
	readonly getPendingUserEntry: () => SessionEntry | null;
} {
	let pendingUserEntry = input?.pendingUserEntry ?? null;
	const setPendingUserEntry = vi.fn((_: string, entry: SessionEntry) => {
		pendingUserEntry = entry;
	});
	const clearPendingUserEntry = vi.fn((_: string) => {
		pendingUserEntry = null;
	});

	const store: Partial<PanelStore> = {
		getHotState: vi.fn(() =>
			Object.assign({}, DEFAULT_PANEL_HOT_STATE, { pendingUserEntry })
		),
		setPendingUserEntry,
		clearPendingUserEntry,
	};

	return {
		store,
		setPendingUserEntry,
		clearPendingUserEntry,
		getPendingUserEntry: () => pendingUserEntry,
	};
}

function makeSessionStore(input?: {
	readonly createFails?: boolean;
	readonly sendFails?: boolean;
}): Partial<SessionStore> {
	const session = makeSession();
	return {
		createSession: vi.fn(() => {
			if (input?.createFails === true) {
				return errAsync(new Error("create failed") as never);
			}
			return okAsync({ kind: "ready" as const, session });
		}),
		sendMessage: vi.fn(() => {
			if (input?.sendFails === true) {
				return errAsync(new Error("send failed") as never);
			}
			return okAsync(undefined);
		}),
		getSessionCold: vi.fn(() => session),
	};
}

describe("AgentInputState optimistic pending entry rollback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("clears pending entry after successful slow-path send", async () => {
		const panel = makePanelStore();
		const sessionStore = makeSessionStore();
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		expect(panel.setPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.getPendingUserEntry()).toBeNull();
	});

	it("clears pending entry when sendMessage fails after session creation", async () => {
		const panel = makePanelStore();
		const sessionStore = makeSessionStore({ sendFails: true });
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isErr()).toBe(true);
		expect(panel.setPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.getPendingUserEntry()).toBeNull();
	});

	it("clears pending entry when createSession fails", async () => {
		const panel = makePanelStore();
		const sessionStore = makeSessionStore({ createFails: true });
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		});

		expect(result.isErr()).toBe(true);
		expect(panel.setPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.getPendingUserEntry()).toBeNull();
	});

	it("clears pending entry when project path is missing", async () => {
		const existingEntry = {
			id: "pending-1",
			type: "user" as const,
			message: {
				content: { type: "text" as const, text: "stale" },
				chunks: [{ type: "text" as const, text: "stale" }],
				sentAt: new Date(),
			},
			timestamp: new Date(),
		};
		const panel = makePanelStore({ pendingUserEntry: existingEntry });
		const sessionStore = makeSessionStore();
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "",
			selectedAgentId: "claude-code",
		});

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(SessionCreationError);
		}
		expect(panel.setPendingUserEntry).not.toHaveBeenCalled();
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.getPendingUserEntry()).toBeNull();
	});

	it("clears pending entry when agent id is missing", async () => {
		const existingEntry = {
			id: "pending-1",
			type: "user" as const,
			message: {
				content: { type: "text" as const, text: "stale" },
				chunks: [{ type: "text" as const, text: "stale" }],
				sentAt: new Date(),
			},
			timestamp: new Date(),
		};
		const panel = makePanelStore({ pendingUserEntry: existingEntry });
		const sessionStore = makeSessionStore();
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			selectedAgentId: null,
		});

		expect(result.isErr()).toBe(true);
		expect(panel.setPendingUserEntry).not.toHaveBeenCalled();
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
		expect(panel.getPendingUserEntry()).toBeNull();
	});

	it("does not replace an existing pending entry before slow-path send", async () => {
		const existingEntry = {
			id: "pending-existing",
			type: "user" as const,
			message: {
				content: { type: "text" as const, text: "Existing" },
				chunks: [{ type: "text" as const, text: "Existing" }],
				sentAt: new Date(),
			},
			timestamp: new Date(),
		};
		const panel = makePanelStore({ pendingUserEntry: existingEntry });
		const sessionStore = makeSessionStore();
		const state = new AgentInputState(
			sessionStore as SessionStore,
			panel.store as PanelStore,
			() => "/repo"
		);

		const result = await state.sendPreparedMessage({
			content: "Hello agent",
			panelId: "panel-1",
			projectPath: "/repo",
			selectedAgentId: "claude-code",
		});

		expect(result.isOk()).toBe(true);
		expect(panel.setPendingUserEntry).not.toHaveBeenCalled();
		expect(panel.clearPendingUserEntry).toHaveBeenCalledTimes(1);
	});
});
