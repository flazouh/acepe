import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionCold } from "$lib/acp/application/dto/session-cold.js";
import { AgentError } from "$lib/acp/errors/app-error.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPreferencesStore } from "$lib/acp/store/agent-preferences-store.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { WorkspaceStore } from "$lib/acp/store/workspace-store.svelte.js";
import type { KeybindingsService } from "$lib/keybindings/service.svelte.js";
import { KeybindingError } from "$lib/keybindings/types.js";

const openPersistedSessionMock = mock(
	(_options: { panelId: string; repairPriority?: "selected" | "visible" }) => {}
);
const zoomInitializeMock = mock((): ResultAsync<void, AgentError> => okAsync(undefined));
const warmRecentTranscriptRowLedgersMock = mock(() =>
	okAsync({
		requestedLimit: 8,
		candidateCount: 0,
		checkedCount: 0,
		rebuiltCount: 0,
		rebuiltFromProviderCount: 0,
		skippedCurrentCount: 0,
		skippedNoJournalCount: 0,
		skippedMissingFactsCount: 0,
		failedCount: 0,
		failedSessionIds: [],
	})
);
const listPreconnectionCapabilitiesMock = mock(() =>
	okAsync({
		status: "resolved",
		availableModels: [],
		currentModelId: "",
		modelsDisplay: { groups: [] },
		providerMetadata: {
			providerBrand: "codex",
			displayName: "Codex",
			displayOrder: 1,
			supportsModelDefaults: true,
			variantGroup: "plain",
			reasoningEffortSupport: false,
			preconnectionSlashMode: "startupGlobal",
			preconnectionCapabilityMode: "startupGlobal",
		},
		availableModes: [],
		currentModeId: "",
	})
);

mock.module("../logic/open-persisted-session.js", () => ({
	openPersistedSession: openPersistedSessionMock,
	setOpenPersistedSessionDiagnosticRecorder: mock(() => () => {}),
}));

mock.module("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		initialize: zoomInitializeMock,
		zoomIn: () => okAsync(undefined),
		zoomOut: () => okAsync(undefined),
		resetZoom: () => okAsync(undefined),
		zoomLevel: 1.0,
		zoomPercentage: "100%",
	}),
	resetZoomService: () => {},
}));

mock.module("$lib/utils/tauri-client/history.js", () => ({
	history: {
		warmRecentTranscriptRowLedgers: warmRecentTranscriptRowLedgersMock,
	},
}));

mock.module("$lib/utils/tauri-client.js", () => ({
	openFileInEditor: mock(() => undefined),
	revealInFinder: mock(() => undefined),
	tauriClient: {
		acp: {
			listPreconnectionCapabilities: listPreconnectionCapabilitiesMock,
		},
	},
}));

mock.module("svelte-sonner", () => ({
	toast: {
		error: mock(() => {}),
		info: mock(() => {}),
		success: mock(() => {}),
		warning: mock(() => {}),
	},
}));

mock.module("runed", () => ({
	Context: class TestContext {
		private value: object | null = null;

		constructor(_name: string) {}

		exists(): boolean {
			return this.value !== null;
		}

		set(value: object): object {
			this.value = value;
			return value;
		}

		get(): object | null {
			return this.value;
		}

		getOr(fallback: object): object {
			return this.value ?? fallback;
		}
	},
	ElementSize: class TestElementSize {
		readonly width = 0;
		readonly height = 0;

		constructor(_node?: object | (() => object | null), _options?: object) {}
	},
	PersistedState: class TestPersistedState<TValue> {
		current: TValue | undefined;

		constructor(_key: string, initialValue?: TValue) {
			this.current = initialValue;
		}
	},
	Previous: class TestPrevious<TValue> {
		current: TValue | undefined;

		constructor(getValue: () => TValue) {
			this.current = getValue();
		}
	},
	AnimationFrames: class TestAnimationFrames {
		readonly current = false;

		start(): void {}

		stop(): void {}
	},
	Debounced: class TestDebounced<TValue> {
		current: TValue | undefined;

		constructor(value?: TValue) {
			this.current = value;
		}
	},
	IsMounted: class TestIsMounted {
		readonly current = true;
	},
	onClickOutside: () => () => {},
	useDebounce: (callback: () => void) => callback,
	useEventListener: () => () => {},
	useResizeObserver: () => () => {},
	watch: Object.assign(
		mock(() => () => {}),
		{
			pre: mock(() => () => {}),
		}
	),
}));

import type { MainAppViewState } from "../logic/main-app-view-state.svelte.js";

type InitializationManagerConstructor =
	typeof import("../logic/managers/initialization-manager.js").InitializationManager;
type InitializationManagerInstance = InstanceType<InitializationManagerConstructor>;
let InitializationManager: InitializationManagerConstructor;

type TestPanel = {
	id: string;
	kind: "agent";
	ownerPanelId: null;
	sessionId: string | null;
	width: number;
	pendingProjectSelection: boolean;
	selectedAgentId: string | null;
	projectPath: string | null;
	agentId: string | null;
	sessionTitle: string | null;
	sourcePath?: string | null;
	worktreePath?: string | null;
};

function buildSession(id: string, agentId: string, projectPath: string, title: string) {
	return {
		id,
		projectPath,
		agentId,
		title,
		createdAt: new Date(),
		updatedAt: new Date(),
		parentId: null,
	};
}

describe("InitializationManager", () => {
	let mockState: MainAppViewState;
	let mockSessionStore: SessionStore;
	let mockAgentStore: AgentStore;
	let mockPanelStore: PanelStore;
	let mockWorkspaceStore: WorkspaceStore;
	let mockProjectManager: ProjectManager;
	let mockAgentPreferencesStore: AgentPreferencesStore;
	let mockKeybindingsService: KeybindingsService;
	let mockSessionOpenHydrator: Pick<
		SessionOpenHydrator,
		"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
	>;
	let manager: InitializationManagerInstance;
	let postStartupTasks: Array<() => void>;
	let restoredPanelPreloadTasks: Array<() => void>;
	let deferredPreferenceTasks: Array<() => void>;
	let schedulePostStartupWork: (callback: () => void) => void;
	let scheduleTranscriptBackfillWork: (callback: () => void) => void;
	let scheduleDeferredPreferenceWork: (callback: () => void) => void;

	async function runPostStartupTasks(): Promise<void> {
		await runImmediateTimers();
		for (let round = 0; round < 5 && postStartupTasks.length > 0; round += 1) {
			const tasks = postStartupTasks;
			postStartupTasks = [];
			for (const task of tasks) {
				task();
			}
			await runImmediateTimers();
		}
	}

	async function runDeferredPreferenceTasks(): Promise<void> {
		await runImmediateTimers();
		for (let round = 0; round < 5 && deferredPreferenceTasks.length > 0; round += 1) {
			const tasks = deferredPreferenceTasks;
			deferredPreferenceTasks = [];
			for (const task of tasks) {
				task();
			}
			await runImmediateTimers();
		}
	}

	async function runRestoredPanelPreloadTasks(): Promise<void> {
		await runImmediateTimers();
		for (let round = 0; round < 5 && restoredPanelPreloadTasks.length > 0; round += 1) {
			const tasks = restoredPanelPreloadTasks;
			restoredPanelPreloadTasks = [];
			for (const task of tasks) {
				task();
			}
			await runImmediateTimers();
		}
	}

	async function runImmediateTimers(): Promise<void> {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
		for (let i = 0; i < 12; i += 1) {
			await Promise.resolve();
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
		for (let i = 0; i < 12; i += 1) {
			await Promise.resolve();
		}
	}

	function createManagerWithSplitBackfillScheduler(): InitializationManagerInstance {
		return new InitializationManager(
			mockState,
			mockSessionStore,
			mockAgentStore,
			mockPanelStore,
			mockWorkspaceStore,
			mockProjectManager,
			mockAgentPreferencesStore,
			mockKeybindingsService,
			mockSessionOpenHydrator,
			schedulePostStartupWork,
			scheduleTranscriptBackfillWork,
			scheduleDeferredPreferenceWork
		);
	}

	beforeEach(async () => {
		if (InitializationManager === undefined) {
			({ InitializationManager } = await import("../logic/managers/initialization-manager.js"));
		}
		openPersistedSessionMock.mockReset();
		zoomInitializeMock.mockReset();
		zoomInitializeMock.mockImplementation(() => okAsync(undefined));
		warmRecentTranscriptRowLedgersMock.mockReset();
		warmRecentTranscriptRowLedgersMock.mockImplementation(() =>
			okAsync({
				requestedLimit: 8,
				candidateCount: 0,
				checkedCount: 0,
				rebuiltCount: 0,
				rebuiltFromProviderCount: 0,
				skippedCurrentCount: 0,
				skippedNoJournalCount: 0,
				skippedMissingFactsCount: 0,
				failedCount: 0,
				failedSessionIds: [],
			})
		);
		listPreconnectionCapabilitiesMock.mockReset();
		listPreconnectionCapabilitiesMock.mockReturnValue(
			okAsync({
				status: "resolved",
				availableModels: [],
				currentModelId: "",
				modelsDisplay: { groups: [] },
				providerMetadata: {
					providerBrand: "codex",
					displayName: "Codex",
					displayOrder: 1,
					supportsModelDefaults: true,
					variantGroup: "plain",
					reasoningEffortSupport: false,
					preconnectionSlashMode: "startupGlobal",
					preconnectionCapabilityMode: "startupGlobal",
				},
				availableModes: [],
				currentModeId: "",
			})
		);
		globalThis.window = {
			addEventListener: mock(() => {}),
			removeEventListener: mock(() => {}),
		} as unknown as Window & typeof globalThis;

		mockState = {
			debugPanelOpen: false,
			settingsModalOpen: false,
			commandPaletteOpen: false,
			initializationInProgress: false,
			initializationComplete: false,
			workspaceRestorationPending: false,
			initializationError: null,
		} as unknown as MainAppViewState;

		mockSessionStore = {
			initializeSessionUpdates: mock(() => okAsync(undefined)),
			loading: {
				loadSessions: mock(() => okAsync([])),
				loadStartupSessions: mock(() => okAsync({ missing: [], aliasRemaps: {} })),
				registerSessionPlaceholder: mock(() => {}),
				preloadSessions: mock(() => okAsync({ loaded: [], missing: [] })),
				scanSessions: mock(() => okAsync(undefined)),
			},
			connection: {
				createSession: mock((options: { agentId: string; projectPath: string; title?: string }) =>
					okAsync({
						kind: "ready",
						session: buildSession(
							"session-1",
							options.agentId,
							options.projectPath,
							options.title ? options.title : "New Thread"
						),
					})
				),
			},
			write: {
				setSessions: mock(() => {}),
			},
			read: {
				getSessionCold: mock(() => undefined),
				getSessionIdentity: mock((sessionId: string) => {
					const session = mockSessionStore.read.getSessionCold(sessionId);
					if (!session) {
						return undefined;
					}
					return {
						id: session.id,
						projectPath: session.projectPath,
						agentId: session.agentId,
						worktreePath: session.worktreePath,
					};
				}),
				getSessionMetadata: mock((sessionId: string) => {
					const session = mockSessionStore.read.getSessionCold(sessionId);
					if (!session) {
						return undefined;
					}
					return {
						title: session.title,
						createdAt: session.createdAt,
						updatedAt: session.updatedAt,
						sourcePath: session.sourcePath,
						sessionLifecycleState: session.sessionLifecycleState,
						parentId: session.parentId,
						sequenceId: session.sequenceId,
					};
				}),
				resolveCanonicalSessionId: mock(() => null),
			},
		} as unknown as SessionStore;

		mockAgentStore = {
			agents: [],
			loadAvailableAgents: mock(() => okAsync([])),
			getAgent: mock((agentId: string | null | undefined) => {
				if (!agentId) {
					return null;
				}
				return mockAgentStore.agents.find((agent) => agent.id === agentId) ?? null;
			}),
			getProviderMetadata: mock((agentId: string | null | undefined) => {
				if (!agentId) {
					return null;
				}
				return (
					mockAgentStore.agents.find((agent) => agent.id === agentId)?.providerMetadata ?? null
				);
			}),
		} as unknown as AgentStore;

		mockPanelStore = {
			panels: [],
			getPanel: mock((panelId: string) =>
				mockPanelStore.panels.find((panel) => panel.id === panelId)
			),
			updatePanelSession: mock(() => {}),
			closePanelBySessionId: mock(() => {}),
			clearPanels: mock(() => {}),
		} as unknown as PanelStore;

		mockWorkspaceStore = {
			load: mock(() =>
				okAsync({
					version: 1,
					panels: [],
					focusedPanelIndex: null,
					panelContainerScrollX: 0,
					savedAt: new Date().toISOString(),
				})
			),
			restore: mock(() => []),
		} as unknown as WorkspaceStore;

		mockProjectManager = {
			recentProjects: [],
			projects: [],
			projectCount: 0,
			projectStorageFresh: true,
			loadProjects: mock((_preferredPaths?: string[]) => okAsync(undefined)),
		} as unknown as ProjectManager;

		mockAgentPreferencesStore = {
			primeStartupDefaults: mock(() => {}),
			initialize: mock(() => okAsync(undefined)),
		} as unknown as AgentPreferencesStore;

		mockKeybindingsService = {
			initialize: mock(() => ({ isOk: () => true, isErr: () => false })),
			upsertAction: mock(() => {}),
			install: mock(() => {}),
			loadUserKeybindings: mock(() => okAsync(undefined)),
			reinstall: mock(() => {}),
			uninstall: mock(() => {}),
		} as unknown as KeybindingsService;

		mockSessionOpenHydrator = {
			beginAttempt: mock(() => "request-1"),
			clearAttempt: mock(() => {}),
			hydrateFound: mock(() =>
				okAsync({
					canonicalSessionId: "session-1",
					openToken: "open-token-1",
					applied: true,
				})
			),
			isCurrentAttempt: mock(() => true),
		};
		postStartupTasks = [];
		restoredPanelPreloadTasks = [];
		deferredPreferenceTasks = [];
		schedulePostStartupWork = mock((callback: () => void) => {
			postStartupTasks.push(callback);
		});
		scheduleTranscriptBackfillWork = mock((callback: () => void) => {
			restoredPanelPreloadTasks.push(callback);
		});
		scheduleDeferredPreferenceWork = mock((callback: () => void) => {
			deferredPreferenceTasks.push(callback);
		});

		manager = new InitializationManager(
			mockState,
			mockSessionStore,
			mockAgentStore,
			mockPanelStore,
			mockWorkspaceStore,
			mockProjectManager,
			mockAgentPreferencesStore,
			mockKeybindingsService,
			mockSessionOpenHydrator,
			schedulePostStartupWork,
			schedulePostStartupWork,
			scheduleDeferredPreferenceWork
		);
	});

	describe("resolveSplashScreen", () => {
		it("treats non-tauri environments as splash already resolved", async () => {
			await manager.resolveSplashScreen();

			expect(mockState.showSplash).toBe(false);
		});
	});

	describe("initialize", () => {
		it("should set initializationInProgress to true at start", async () => {
			const result = manager.initialize();
			expect(mockState.initializationInProgress).toBe(true);
			await result;
		});

		it("should set initializationComplete to true on success", async () => {
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);
			expect(mockState.initializationInProgress).toBe(false);
		});

		it("should initialize keybindings service", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.initialize).toHaveBeenCalled();
		});

		it("should install keybindings on window", async () => {
			await manager.initialize();
			expect(mockKeybindingsService.install).toHaveBeenCalledWith(window);
		});

		it("should initialize session updates", async () => {
			await manager.initialize();
			expect(mockSessionStore.initializeSessionUpdates).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.initializeSessionUpdates).toHaveBeenCalled();
		});

		it("warms recent transcript row ledgers only after transcript backfill work", async () => {
			manager = createManagerWithSplitBackfillScheduler();

			await manager.initialize();
			expect(warmRecentTranscriptRowLedgersMock).not.toHaveBeenCalled();

			await runPostStartupTasks();
			expect(warmRecentTranscriptRowLedgersMock).not.toHaveBeenCalled();

			await runRestoredPanelPreloadTasks();

			expect(warmRecentTranscriptRowLedgersMock).toHaveBeenCalledWith(8);
		});

		it("skips transcript row ledger warmup while a session panel is open", async () => {
			manager = createManagerWithSplitBackfillScheduler();
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 1",
				},
			];

			await manager.initialize();
			await runPostStartupTasks();
			await runRestoredPanelPreloadTasks();

			expect(warmRecentTranscriptRowLedgersMock).not.toHaveBeenCalled();
		});

		it("does not wait for session updates before completing startup", async () => {
			const sessionUpdatesResolver: { current: (() => void) | null } = { current: null };
			mockSessionStore.initializeSessionUpdates = mock(() =>
				ResultAsync.fromPromise(
					new Promise<void>((resolve) => {
						sessionUpdatesResolver.current = resolve;
					}),
					() => new AgentError("initializeSessionUpdates", new Error("Failed"))
				)
			) as SessionStore["initializeSessionUpdates"];

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const resultOrTimeout = await Promise.race([
				manager.initialize(),
				new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), 50);
				}),
			]);

			expect(resultOrTimeout).not.toBe("timeout");
			if (resultOrTimeout !== "timeout") {
				expect(resultOrTimeout.isOk()).toBe(true);
			}
			expect(mockSessionStore.initializeSessionUpdates).not.toHaveBeenCalled();
			expect(mockState.initializationComplete).toBe(true);

			await runPostStartupTasks();

			expect(mockSessionStore.initializeSessionUpdates).toHaveBeenCalled();
			if (sessionUpdatesResolver.current === null) {
				throw new Error("session updates promise was not created");
			}
			sessionUpdatesResolver.current();
		});

		it("loads projects immediately and agents after delayed startup work", async () => {
			await manager.initialize();
			expect(mockProjectManager.loadProjects).not.toHaveBeenCalled();
			expect(mockAgentStore.loadAvailableAgents).not.toHaveBeenCalled();
			expect(mockKeybindingsService.loadUserKeybindings).not.toHaveBeenCalled();

			await runImmediateTimers();

			expect(mockProjectManager.loadProjects).toHaveBeenCalled();
			expect(mockAgentStore.loadAvailableAgents).not.toHaveBeenCalled();
			expect(mockKeybindingsService.loadUserKeybindings).toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockAgentStore.loadAvailableAgents).toHaveBeenCalled();
		});

		it("does not wait for user keybindings before completing startup", async () => {
			const userKeybindingsResolver: { current: (() => void) | null } = { current: null };
			mockKeybindingsService.loadUserKeybindings = mock(() =>
				ResultAsync.fromPromise(
					new Promise<void>((resolve) => {
						userKeybindingsResolver.current = resolve;
					}),
					() => new KeybindingError("INSTALL_FAILED", "Failed")
				)
			) as KeybindingsService["loadUserKeybindings"];

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const resultOrTimeout = await Promise.race([
				manager.initialize(),
				new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), 50);
				}),
			]);

			expect(resultOrTimeout).not.toBe("timeout");
			if (resultOrTimeout !== "timeout") {
				expect(resultOrTimeout.isOk()).toBe(true);
			}
			expect(mockState.initializationComplete).toBe(true);
			expect(mockKeybindingsService.loadUserKeybindings).not.toHaveBeenCalled();

			await runImmediateTimers();

			expect(mockKeybindingsService.loadUserKeybindings).toHaveBeenCalled();
			if (userKeybindingsResolver.current === null) {
				throw new Error("user keybindings promise was not created");
			}
			userKeybindingsResolver.current();
		});

		it("completes startup before workspace restore finishes", async () => {
			mockWorkspaceStore.load = mock(() =>
				ResultAsync.fromPromise(
					new Promise<never>(() => {}),
					() => new AgentError("workspace", new Error("Timed out"))
				)
			) as WorkspaceStore["load"];
			mockState.shellReady = false;

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const resultOrTimeout = await Promise.race([
				manager.initialize(),
				new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), 50);
				}),
			]);

			expect(resultOrTimeout).not.toBe("timeout");
			if (resultOrTimeout !== "timeout") {
				expect(resultOrTimeout.isOk()).toBe(true);
			}
			expect(mockSessionStore.initializeSessionUpdates).not.toHaveBeenCalled();
			expect(mockWorkspaceStore.load).not.toHaveBeenCalled();
			expect(mockWorkspaceStore.restore).not.toHaveBeenCalled();
			expect(mockState.shellReady).toBe(true);
			expect(mockState.initializationComplete).toBe(true);
			expect(mockState.workspaceRestorationPending).toBe(true);

			await runImmediateTimers();

			expect(mockWorkspaceStore.load).toHaveBeenCalled();
			expect(mockWorkspaceStore.restore).not.toHaveBeenCalled();
		});

		it("completes initialization while agents are still loading after startup", async () => {
			mockAgentStore.loadAvailableAgents = mock(() =>
				ResultAsync.fromPromise(
					new Promise<never>(() => {}),
					() => new AgentError("loadAgents", new Error("Timed out"))
				)
			) as AgentStore["loadAvailableAgents"];
			mockState.shellReady = false;

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const resultOrTimeout = await Promise.race([
				manager.initialize(),
				new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), 50);
				}),
			]);

			expect(resultOrTimeout).not.toBe("timeout");
			if (resultOrTimeout !== "timeout") {
				expect(resultOrTimeout.isOk()).toBe(true);
			}
			expect(mockSessionStore.initializeSessionUpdates).not.toHaveBeenCalled();
			expect(mockWorkspaceStore.restore).not.toHaveBeenCalled();
			expect(mockState.shellReady).toBe(true);
			expect(mockState.initializationComplete).toBe(true);

			await runImmediateTimers();

			expect(mockWorkspaceStore.restore).toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.initializeSessionUpdates).toHaveBeenCalled();
			expect(mockAgentStore.loadAvailableAgents).toHaveBeenCalled();
		});

		it("primes agent preferences after loading metadata", async () => {
			await manager.initialize();
			expect(mockAgentPreferencesStore.primeStartupDefaults).not.toHaveBeenCalled();

			await runImmediateTimers();

			expect(mockAgentPreferencesStore.primeStartupDefaults).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockAgentPreferencesStore.primeStartupDefaults).toHaveBeenCalledWith(
				mockAgentStore.agents,
				mockProjectManager.projectCount
			);
		});

		it("loads persisted agent preferences after the deferred preference lane runs", async () => {
			await manager.initialize();
			expect(mockAgentPreferencesStore.initialize).not.toHaveBeenCalled();

			await runImmediateTimers();
			await runPostStartupTasks();
			expect(mockAgentPreferencesStore.initialize).not.toHaveBeenCalled();

			await runDeferredPreferenceTasks();

			expect(mockAgentPreferencesStore.initialize).toHaveBeenCalledWith(
				mockAgentStore.agents,
				mockProjectManager.projectCount
			);
		});

		it("does not wait for persisted agent preferences before completing startup", async () => {
			const agentPreferencesResolver: { current: (() => void) | null } = { current: null };
			mockAgentPreferencesStore.initialize = mock(() =>
				ResultAsync.fromPromise(
					new Promise<void>((resolve) => {
						agentPreferencesResolver.current = resolve;
					}),
					() => new AgentError("agent_preferences", new Error("Failed"))
				)
			) as AgentPreferencesStore["initialize"];

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const result = await manager.initialize();

			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);
			expect(mockWorkspaceStore.load).not.toHaveBeenCalled();
			expect(mockAgentPreferencesStore.initialize).not.toHaveBeenCalled();

			await runImmediateTimers();
			expect(mockWorkspaceStore.load).toHaveBeenCalled();
			await runPostStartupTasks();
			expect(mockAgentPreferencesStore.initialize).not.toHaveBeenCalled();

			await runDeferredPreferenceTasks();

			expect(mockAgentPreferencesStore.initialize).toHaveBeenCalled();
			if (agentPreferencesResolver.current === null) {
				throw new Error("agent preferences promise was not created");
			}
			agentPreferencesResolver.current();
		});

		it("should restore workspace state", async () => {
			await manager.initialize();
			expect(mockWorkspaceStore.restore).not.toHaveBeenCalled();

			await runImmediateTimers();

			expect(mockWorkspaceStore.restore).toHaveBeenCalled();
		});

		it("starts startup session history scans without the idle scheduler", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			await manager.initialize();

			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.scanSessions).not.toHaveBeenCalled();

			await runImmediateTimers();

			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.scanSessions).toHaveBeenCalledWith(["/project1"]);
		});

		it("hydrates restored panels before scanning the sidebar metadata", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
				{
					path: "/project2",
					name: "Project 2",
					createdAt: new Date(),
					color: "green",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 1",
				},
			];

			const restoredSession = buildSession("session-1", "claude-code", "/project1", "Session 1");
			const callOrder: string[] = [];

			mockSessionStore.loading.loadStartupSessions = mock(() => {
				callOrder.push("startup");
				return okAsync({ missing: [], aliasRemaps: {} });
			});
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1" ? restoredSession : undefined
			);
			mockSessionStore.loading.scanSessions = mock((projectPaths: string[]) => {
				callOrder.push(`scan:${projectPaths.join(",")}`);
				return okAsync(undefined);
			});

			await manager.initialize();
			await Promise.resolve();
			await Promise.resolve();

			expect(mockSessionStore.loading.loadStartupSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(callOrder).toEqual([]);
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
			expect(mockSessionStore.loading.scanSessions).toHaveBeenCalledWith([
				"/project1",
				"/project2",
			]);
			expect(callOrder).toEqual(["startup", "scan:/project1,/project2"]);
		});

		it("starts restored session metadata and transcript loading without idle schedulers", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 1",
				},
			];

			const restoredSession = buildSession("session-1", "claude-code", "/project1", "Session 1");
			mockSessionStore.loading.loadStartupSessions = mock(() =>
				okAsync({ missing: [], aliasRemaps: {} })
			);
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1" ? restoredSession : undefined
			);

			await manager.initialize();
			await runImmediateTimers();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("loads and opens the focused restored panel before other panels", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => [
				"session-1",
				"session-2",
			]) as WorkspaceStore["restore"];
			mockPanelStore.focusedPanelId = "panel-2";
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 1",
				},
				{
					id: "panel-2",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-2",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 2",
				},
			];
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				buildSession(sessionId, "claude-code", "/project1", sessionId)
			);

			await manager.initialize();
			await runImmediateTimers();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenNthCalledWith(1, [
				"session-2",
			]);
			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenNthCalledWith(2, [
				"session-1",
			]);
			expect(mockProjectManager.loadProjects).toHaveBeenCalledWith(["/project1"]);
			expect(openPersistedSessionMock.mock.calls.map((call) => call[0]?.panelId)).toEqual([
				"panel-2",
				"panel-1",
			]);
			expect(openPersistedSessionMock.mock.calls.map((call) => call[0]?.repairPriority)).toEqual([
				"selected",
				"visible",
			]);
		});

		it("hydrates restored panels even when zoom metadata fails after startup", async () => {
			zoomInitializeMock.mockImplementation(() =>
				errAsync(new AgentError("initializeZoom", new Error("Failed")))
			);
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Session 1",
				},
			];

			const restoredSession = buildSession("session-1", "claude-code", "/project1", "Session 1");
			mockSessionStore.loading.loadStartupSessions = mock(() =>
				okAsync({ missing: [], aliasRemaps: {} })
			);
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1" ? restoredSession : undefined
			);

			await manager.initialize();
			await runPostStartupTasks();

			expect(zoomInitializeMock).toHaveBeenCalled();
			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("clears orphaned restored session ids before attempting startup reconnect", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["missing-session"]) as WorkspaceStore["restore"];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "missing-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Old Session",
					sourcePath: "/project1/.claude/projects/missing-session.jsonl",
				},
			];
			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});
			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) =>
					panel.id === panelId
						? {
								id: panel.id,
								kind: panel.kind,
								ownerPanelId: panel.ownerPanelId,
								sessionId,
								width: panel.width,
								pendingProjectSelection: panel.pendingProjectSelection,
								selectedAgentId: panel.selectedAgentId,
								projectPath: panel.projectPath,
								agentId: panel.agentId,
								sessionTitle: panel.sessionTitle,
								sourcePath: panel.sourcePath,
								worktreePath: panel.worktreePath,
							}
						: panel
				);
			});
			await manager.initialize();

			expect(mockSessionStore.loading.loadStartupSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith([
				"missing-session",
			]);
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", null);
			expect(openPersistedSessionMock).not.toHaveBeenCalled();
		});

		it("preserves recoverable created-session restored ids", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["recoverable-session"]) as WorkspaceStore["restore"];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "recoverable-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: null,
					sessionTitle: "Recover me",
					sourcePath: null,
				},
			];

			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});

			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) =>
					panel.id === panelId
						? {
								id: panel.id,
								kind: panel.kind,
								ownerPanelId: panel.ownerPanelId,
								sessionId,
								width: panel.width,
								pendingProjectSelection: panel.pendingProjectSelection,
								selectedAgentId: panel.selectedAgentId,
								projectPath: panel.projectPath,
								agentId: panel.agentId,
								sessionTitle: panel.sessionTitle,
								sourcePath: panel.sourcePath,
								worktreePath: panel.worktreePath,
							}
						: panel
				);
			});

			await manager.initialize();

			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
		});

		it("preserves recoverable created-session restored ids without frontend agent hints", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["recoverable-session"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "recoverable-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: null,
					projectPath: "/project1",
					agentId: null,
					sessionTitle: "Recover me",
					sourcePath: null,
				},
			] as TestPanel[];

			await manager.initialize();

			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
		});

		it("preloads restored sessions using stored session metadata when panel metadata is missing", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "cursor",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/project1",
							agentId: "cursor",
							title: "Recovered session",
							createdAt: new Date(),
							updatedAt: new Date(),
							parentId: null,
						}
					: undefined
			);

			await manager.initialize();
			await Promise.resolve();

			expect(mockSessionStore.loading.loadStartupSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("preloads restored sessions with persisted worktree context", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					sourcePath: "/project1/.cursor/sessions/session-1.json",
					worktreePath: "/project1/.git/worktrees/feature-a",
				},
			];
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/project1",
							agentId: "claude-code",
							title: "Feature thread",
							createdAt: new Date(),
							updatedAt: new Date(),
							parentId: null,
							worktreePath: "/project1/.git/worktrees/feature-a",
							sourcePath: "/project1/.cursor/sessions/session-1.json",
						}
					: undefined
			);

			await manager.initialize();
			await Promise.resolve();

			expect(mockSessionStore.loading.loadStartupSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("loads missing restored session metadata from panel hints before startup open", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/project1",
					agentId: "claude-code",
					sessionTitle: "Recovered session",
					sourcePath: "/project1/.claude/projects/session-1.jsonl",
					worktreePath: "/project1/.git/worktrees/feature-a",
				},
			];
			mockSessionStore.read.getSessionCold = mock(() => undefined);
			mockSessionStore.loading.registerSessionPlaceholder = mock(() => {});

			await manager.initialize();
			await Promise.resolve();

			expect(mockSessionStore.loading.registerSessionPlaceholder).not.toHaveBeenCalled();
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.registerSessionPlaceholder).toHaveBeenCalledWith(
				"session-1",
				"/project1",
				"claude-code",
				{
					sourcePath: "/project1/.claude/projects/session-1.jsonl",
					worktreePath: "/project1/.git/worktrees/feature-a",
					placeholderTitle: "Recovered session",
				}
			);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("preloads restored sessions from canonical session metadata before stale panel cache", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "codex",
					projectPath: "/stale-project",
					agentId: "codex",
					sessionTitle: "Stale cached title",
					sourcePath: "/stale/session.json",
					worktreePath: "/stale/.git/worktrees/feature-a",
				},
			];
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "session-1"
					? {
							id: "session-1",
							projectPath: "/project1",
							agentId: "claude-code",
							title: "Canonical title",
							createdAt: new Date(),
							updatedAt: new Date(),
							parentId: null,
							sourcePath: "/project1/.claude/session-1.jsonl",
							worktreePath: "/project1/.git/worktrees/feature-b",
						}
					: undefined
			);

			await manager.initialize();
			await Promise.resolve();

			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("does not clear a restored worktree session when history contains it", async () => {
			mockProjectManager.projects = [
				{
					path: "/Users/example/Documents/acepe",
					name: "acepe",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockWorkspaceStore.restore = mock(() => ["session-1"]) as WorkspaceStore["restore"];

			let storedSessions: SessionCold[] = [
				buildSession(
					"session-1",
					"claude-code",
					"/Users/example/Documents/acepe",
					"Feature thread"
				),
			];
			storedSessions[0] = {
				id: storedSessions[0].id,
				projectPath: storedSessions[0].projectPath,
				agentId: storedSessions[0].agentId,
				title: storedSessions[0].title,
				createdAt: storedSessions[0].createdAt,
				updatedAt: storedSessions[0].updatedAt,
				parentId: storedSessions[0].parentId,
				worktreePath: "/Users/example/.acepe/worktrees/worktree-123456/feature-branch",
			};

			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "session-1",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: "/Users/example/Documents/acepe",
					agentId: "claude-code",
					sessionTitle: "Feature thread",
					worktreePath: "/Users/example/.acepe/worktrees/worktree-123456/feature-branch",
				},
			];

			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});

			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) => {
					if (panel.id === panelId) {
						return {
							id: panel.id,
							kind: panel.kind,
							ownerPanelId: panel.ownerPanelId,
							sessionId,
							width: panel.width,
							pendingProjectSelection: panel.pendingProjectSelection,
							selectedAgentId: panel.selectedAgentId,
							projectPath: panel.projectPath,
							agentId: panel.agentId,
							sessionTitle: panel.sessionTitle,
							sourcePath: panel.sourcePath,
							worktreePath: panel.worktreePath,
						};
					}

					return panel;
				});
			});

			mockSessionStore.write.setSessions = mock((sessions) => {
				storedSessions = sessions;
			});

			mockSessionStore.loading.loadSessions = mock(() => {
				mockSessionStore.write.setSessions(storedSessions);
				return okAsync(storedSessions);
			});

			mockSessionStore.read.getSessionCold = mock((sessionId: string) => {
				return storedSessions.find((session) => session.id === sessionId);
			});

			await manager.initialize();
			await Promise.resolve();

			expect(mockSessionStore.loading.loadStartupSessions).not.toHaveBeenCalled();
			expect(mockSessionStore.loading.loadSessions).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.loading.loadStartupSessions).toHaveBeenCalledWith(["session-1"]);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "session-1",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("remaps aliased panel session ids before validation", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			// Panel was persisted with a provider alias ID
			mockWorkspaceStore.restore = mock(() => ["claude-session"]) as WorkspaceStore["restore"];
			let currentPanels: TestPanel[] = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: "claude-session",
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "opencode",
					projectPath: "/project1",
					agentId: "opencode",
					sessionTitle: "Aliased Session",
					sourcePath: "/opencode/storage/session/acepe-uuid.json",
				},
			];

			Object.defineProperty(mockPanelStore, "panels", {
				configurable: true,
				get: () => currentPanels,
			});

			mockPanelStore.updatePanelSession = mock((panelId: string, sessionId: string | null) => {
				currentPanels = currentPanels.map((panel) =>
					panel.id === panelId
						? {
								id: panel.id,
								kind: panel.kind,
								ownerPanelId: panel.ownerPanelId,
								sessionId,
								width: panel.width,
								pendingProjectSelection: panel.pendingProjectSelection,
								selectedAgentId: panel.selectedAgentId,
								projectPath: panel.projectPath,
								agentId: panel.agentId,
								sessionTitle: panel.sessionTitle,
								sourcePath: panel.sourcePath,
								worktreePath: panel.worktreePath,
							}
						: panel
				);
			});

			// Backend returns the session under its canonical ID with an alias remap
			const canonicalSession = buildSession(
				"acepe-uuid",
				"opencode",
				"/project1",
				"Aliased Session"
			);
			mockSessionStore.loading.loadStartupSessions = mock(() => {
				return okAsync({
					missing: [],
					aliasRemaps: { "claude-session": "acepe-uuid" },
				});
			});
			mockSessionStore.read.getSessionCold = mock((sessionId: string) =>
				sessionId === "acepe-uuid" ? canonicalSession : undefined
			);
			await manager.initialize();
			await Promise.resolve();

			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
			expect(openPersistedSessionMock).not.toHaveBeenCalled();

			await runPostStartupTasks();

			// Panel should be remapped from alias to canonical ID
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", "acepe-uuid");
			// Panel should NOT be cleared as orphaned
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalledWith("panel-1", null);
			expect(openPersistedSessionMock).toHaveBeenCalledWith({
				panelId: "panel-1",
				sessionId: "acepe-uuid",
				sessionStore: mockSessionStore,
				sessionOpenHydrator: mockSessionOpenHydrator,
				isPanelCurrent: expect.any(Function),
				timeoutMs: 30_000,
				source: "initialization-manager",
				repairPriority: "visible",
			});
		});

		it("continues initialization when background workspace restore fails", async () => {
			mockWorkspaceStore.load = mock(() =>
				errAsync(new AgentError("workspace", new Error("Failed")))
			) as WorkspaceStore["load"];

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);

			await runImmediateTimers();

			expect(mockState.initializationError).toBeInstanceOf(Error);
			expect(mockState.workspaceRestorationPending).toBe(false);
		});

		it("continues initialization when background agent metadata fails", async () => {
			mockAgentStore.loadAvailableAgents = mock(() =>
				errAsync(new AgentError("loadAgents", new Error("Failed")))
			) as AgentStore["loadAvailableAgents"];

			manager = new InitializationManager(
				mockState,
				mockSessionStore,
				mockAgentStore,
				mockPanelStore,
				mockWorkspaceStore,
				mockProjectManager,
				mockAgentPreferencesStore,
				mockKeybindingsService,
				mockSessionOpenHydrator,
				schedulePostStartupWork,
				schedulePostStartupWork,
				scheduleDeferredPreferenceWork
			);

			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockState.initializationComplete).toBe(true);

			await runPostStartupTasks();

			expect(mockAgentStore.loadAvailableAgents).toHaveBeenCalled();
			expect(mockAgentPreferencesStore.primeStartupDefaults).not.toHaveBeenCalled();
		});

		it("skips startup session auto-creation when provider metadata requires explicit user action", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockAgentStore.agents = [
				{
					id: "quiet-agent",
					name: "Quiet Agent",
					icon: "quiet-agent",
					providerMetadata: {
						providerBrand: "custom",
						displayName: "Quiet Agent",
						displayOrder: 99,
						supportsModelDefaults: false,
						variantGroup: "plain",
						defaultAlias: undefined,
						reasoningEffortSupport: false,
						preconnectionSlashMode: "startupGlobal",
						preconnectionCapabilityMode: "startupGlobal",
						implicitSessionCreationMode: "explicitUserAction",
					},
				},
			] as unknown as AgentStore["agents"];
			mockAgentStore.loadAvailableAgents = mock(() =>
				okAsync(mockAgentStore.agents)
			) as AgentStore["loadAvailableAgents"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "quiet-agent",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();
			await runPostStartupTasks();

			expect(mockSessionStore.connection.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
		});

		it("does not auto-create startup sessions before agent metadata is loaded", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockAgentStore.loadAvailableAgents = mock(() =>
				ResultAsync.fromPromise(
					new Promise<never>(() => {}),
					() => new AgentError("loadAgents", new Error("Timed out"))
				)
			) as AgentStore["loadAvailableAgents"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();

			expect(mockSessionStore.connection.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.connection.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
		});

		it("should keep startup session auto-creation after agent metadata loads", async () => {
			mockProjectManager.projects = [
				{
					path: "/project1",
					name: "Project 1",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockAgentStore.agents = [
				{
					id: "claude-code",
					name: "Claude Code",
					icon: "claude-code",
					providerMetadata: {
						providerBrand: "claude",
						displayName: "Claude Code",
						displayOrder: 1,
						supportsModelDefaults: true,
						variantGroup: "plain",
						defaultAlias: undefined,
						reasoningEffortSupport: false,
						preconnectionSlashMode: "startupGlobal",
						preconnectionCapabilityMode: "startupGlobal",
					},
				},
			] as unknown as AgentStore["agents"];
			mockAgentStore.loadAvailableAgents = mock(() =>
				okAsync(mockAgentStore.agents)
			) as AgentStore["loadAvailableAgents"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();
			expect(mockSessionStore.connection.createSession).not.toHaveBeenCalled();

			await runPostStartupTasks();

			expect(mockSessionStore.connection.createSession).toHaveBeenCalledWith({
				agentId: "claude-code",
				projectPath: "/project1",
			});
			expect(mockPanelStore.updatePanelSession).toHaveBeenCalledWith("panel-1", "session-1");
		});

		it("does not auto-create startup sessions from cached project data", async () => {
			mockProjectManager.projectStorageFresh = false;
			mockProjectManager.projects = [
				{
					path: "/cached-project",
					name: "Cached Project",
					createdAt: new Date(),
					color: "blue",
				},
			];
			mockAgentStore.agents = [
				{
					id: "claude-code",
					name: "Claude Code",
					icon: "claude-code",
					providerMetadata: {
						providerBrand: "claude",
						displayName: "Claude Code",
						displayOrder: 1,
						supportsModelDefaults: true,
						variantGroup: "plain",
						defaultAlias: undefined,
						reasoningEffortSupport: false,
						preconnectionSlashMode: "startupGlobal",
						preconnectionCapabilityMode: "startupGlobal",
					},
				},
			] as unknown as AgentStore["agents"];
			mockAgentStore.loadAvailableAgents = mock(() =>
				okAsync(mockAgentStore.agents)
			) as AgentStore["loadAvailableAgents"];
			mockPanelStore.panels = [
				{
					id: "panel-1",
					kind: "agent",
					ownerPanelId: null,
					sessionId: null,
					width: 600,
					pendingProjectSelection: false,
					selectedAgentId: "claude-code",
					projectPath: null,
					agentId: null,
					sessionTitle: null,
				},
			];

			await manager.initialize();
			await runPostStartupTasks();

			expect(mockSessionStore.connection.createSession).not.toHaveBeenCalled();
			expect(mockPanelStore.updatePanelSession).not.toHaveBeenCalled();
		});

		it("should not initialize if already in progress", async () => {
			mockState.initializationInProgress = true;
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockKeybindingsService.initialize).not.toHaveBeenCalled();
		});

		it("should not initialize if already complete", async () => {
			mockState.initializationComplete = true;
			const result = await manager.initialize();
			expect(result.isOk()).toBe(true);
			expect(mockKeybindingsService.initialize).not.toHaveBeenCalled();
		});
	});

	describe("cleanup", () => {
		it("should uninstall keybindings", () => {
			manager.cleanup();
			expect(mockKeybindingsService.uninstall).toHaveBeenCalled();
		});

		it("should reset initialization flags", () => {
			mockState.initializationInProgress = true;
			mockState.initializationComplete = true;
			manager.cleanup();
			expect(mockState.initializationInProgress).toBe(false);
			expect(mockState.initializationComplete).toBe(false);
		});
	});
});
