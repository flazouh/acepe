
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import { ConnectionError, SessionNotFoundError } from "$lib/acp/errors/app-error.js";
import type { ConnectionStore } from "$lib/acp/store/connection-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import { SessionSelectionError } from "../errors/main-app-view-error.js";
import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";
import { SessionHandler } from "../logic/managers/session-handler.js";

describe("SessionHandler", () => {
	let mockState: MainAppViewState;
	let mockSessionStore: SessionStore;
	let mockPanelStore: PanelStore;
	let mockConnectionStore: ConnectionStore;
	let handler: SessionHandler;
	let mockSessionsArray: any[];

	beforeEach(() => {
		mockState = {} as MainAppViewState;

		// Create mock sessions array - accessible to tests for setup
		mockSessionsArray = [];

		mockSessionStore = {
			get sessions() {
				return mockSessionsArray;
			},
			getSessionDetail: mock(() => null),
			getSession: mock((id: string) => mockSessionsArray.find((s: any) => s.id === id)),
			getSessionById: mock((id: string) => mockSessionsArray.find((s: any) => s.id === id)),
			loadHistoricalSession: mock((sessionId: string) => {
				const session = { id: sessionId };
				mockSessionsArray.push(session);
				return okAsync(session as any);
			}),
			preloadSessions: mock(() => okAsync({ loaded: ["session-1"], missing: [] } as any)),
			connectSession: mock(() => okAsync({} as any)),
			createSession: mock(() => okAsync({ id: "acp-session-id" } as any)),
			setSessionLoading: mock(() => {}),
			setSessionLoaded: mock(() => {}),
			removeSession: mock((id: string) => {
				const index = mockSessionsArray.findIndex((s: any) => s.id === id);
				if (index !== -1) {
					mockSessionsArray.splice(index, 1);
				}
			}),
		} as unknown as SessionStore;

		mockPanelStore = {
			openSession: mock(() => {}),
			updatePanelSession: mock(() => {}),
			closePanelBySessionId: mock(() => {}),
			setPanelProjectPath: mock(() => {}),
			panels: [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 450,
					pendingProjectSelection: false,
					selectedAgentId: "agent-1",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			],
		} as unknown as PanelStore;

		mockConnectionStore = {
			send: mock(() => {}),
		} as unknown as ConnectionStore;

		handler = new SessionHandler(mockState, mockSessionStore, mockPanelStore);
	});

	describe("selectSession", () => {
		it("should open session that exists in memory", async () => {
			const session = {
				id: "session-1",
				title: "Test Session",
				projectPath: "/test",
			};
			mockSessionsArray.push(session as any);

			const result = await handler.selectSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(mockPanelStore.openSession).toHaveBeenCalledWith("session-1", DEFAULT_PANEL_WIDTH);
		});

		it("should load historical session if not in memory", async () => {
			const sessionInfo: SessionListItem = {
				id: "session-1",
				title: "Test Session",
				projectPath: "/test",
				projectName: "Test",
				projectColor: "blue",
				agentId: "agent-1",
				sourcePath: "/tmp/session-1.store.db",
				worktreePath: "/test/.worktrees/feature-x",
				createdAt: new Date(),
				updatedAt: new Date(),
				isOpen: false,
				activity: null,
				parentId: null,
			};

			const result = await handler.selectSession("session-1", sessionInfo);

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.loadHistoricalSession).toHaveBeenCalledWith(
				"session-1",
				"/test",
				"Test Session",
				"agent-1",
				"/tmp/session-1.store.db",
				"/test/.worktrees/feature-x"
			);
		});

		it("should preload session details if not cached", async () => {
			mockSessionStore.getSessionDetail = mock(() => null);
			mockSessionsArray.push({ id: "session-1" } as any);

			const result = await handler.selectSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.preloadSessions).toHaveBeenCalledWith(["session-1"]);
		});

		it("should not preload if details are already cached", async () => {
			mockSessionStore.getSessionDetail = mock(() => ({ entries: [] }) as any);
			mockSessionsArray.push({ id: "session-1" } as any);

			const result = await handler.selectSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.preloadSessions).not.toHaveBeenCalled();
		});

		it("should auto-connect session after opening", async () => {
			mockSessionsArray.push({ id: "session-1" } as any);
			mockSessionStore.getSessionDetail = mock(() => ({ entries: [] }) as any);

			const result = await handler.selectSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.connectSession).toHaveBeenCalledWith("session-1");
		});

		it("should auto-connect codex session after opening", async () => {
			mockSessionsArray.push({ id: "session-codex", agentId: "codex" } as any);
			mockSessionStore.getSessionDetail = mock(() => ({ entries: [] }) as any);

			const result = await handler.selectSession("session-codex");

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.connectSession).toHaveBeenCalledWith("session-codex");
		});

		it("should return error if session not found and no sessionInfo", async () => {
			const result = await handler.selectSession("unknown-session");

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error).toBeInstanceOf(SessionSelectionError);
			}
		});

		it("should mark missing session as loaded (empty) instead of removing it", async () => {
			mockSessionStore.preloadSessions = mock(() =>
				okAsync({ loaded: [], missing: ["session-1"] } as any)
			);
			mockSessionsArray.push({ id: "session-1" } as any);
			mockSessionStore.getSessionDetail = mock(() => null);

			const result = await handler.selectSession("session-1");

			// With async preloading, we return success immediately
			expect(result.isOk()).toBe(true);

			// Wait for async preload to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Session should be marked as loaded (empty), NOT removed
			expect(mockSessionStore.setSessionLoaded).toHaveBeenCalledWith("session-1");
			expect(mockSessionStore.removeSession).not.toHaveBeenCalled();
			expect(mockPanelStore.closePanelBySessionId).not.toHaveBeenCalled();
		});

		it("should return error if loadHistoricalSession fails", async () => {
			const sessionInfo: SessionListItem = {
				id: "session-1",
				title: "Test",
				projectPath: "/test",
				projectName: "Test",
				projectColor: "blue",
				agentId: "agent-1",
				sourcePath: "/tmp/session-1.store.db",
				createdAt: new Date(),
				updatedAt: new Date(),
				isOpen: false,
				activity: null,
				parentId: null,
			};
			mockSessionStore.loadHistoricalSession = mock(() =>
				errAsync(new SessionNotFoundError("session-1"))
			);

			const result = await handler.selectSession("session-1", sessionInfo);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("createSession", () => {
		it("should create session and open it", async () => {
			const options = {
				agentId: "agent-1",
				projectPath: "/test",
				projectName: "Test Project",
			};

			const result = await handler.createSession(options);

			expect(result.isOk()).toBe(true);
			expect(mockSessionStore.createSession).toHaveBeenCalledWith({
				agentId: "agent-1",
				projectPath: "/test",
			});
			expect(mockPanelStore.openSession).toHaveBeenCalledWith(
				"acp-session-id",
				DEFAULT_PANEL_WIDTH
			);
		});

		it("should return error if createSession fails", async () => {
			mockSessionStore.createSession = mock(() =>
				errAsync(new ConnectionError("new-session", new Error("Create failed")))
			);

			const result = await handler.createSession({
				agentId: "agent-1",
				projectPath: "/test",
			});

			expect(result.isErr()).toBe(true);
		});
	});

	describe("createSessionForProject", () => {
		it("should defer session creation until first message and only update panel project", async () => {
			const project = { path: "/test", name: "Test Project" };

			const result = await handler.createSessionForProject("panel-1", project);

			expect(result.isOk()).toBe(true);
			expect(mockPanelStore.setPanelProjectPath).toHaveBeenCalledWith("panel-1", "/test");
			expect(mockConnectionStore.send).not.toHaveBeenCalled();
			expect(mockSessionStore.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
		});

		it("should return error if no agent selected for panel", async () => {
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 450,
					pendingProjectSelection: false,
					selectedAgentId: null,
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			const result = await handler.createSessionForProject("panel-1", {
				path: "/test",
				name: "Test",
			});

			expect(result.isErr()).toBe(true);
		});

		it("should return error if the panel does not exist", async () => {
			mockPanelStore.panels = [];

			const result = await handler.createSessionForProject("missing-panel", {
				path: "/test",
				name: "Test",
			});

			expect(result.isErr()).toBe(true);
		});
	});
});
