import { errAsync, okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../errors/app-error.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import { SessionEventService } from "../session-event-service.svelte.js";
import type { SessionCold, SessionHotState } from "../types.js";
import type { ICapabilitiesManager } from "./interfaces/capabilities-manager.js";
import type { IConnectionManager } from "./interfaces/connection-manager.js";
import type { IEntryManager } from "./interfaces/entry-manager.js";
import type { IHotStateManager } from "./interfaces/hot-state-manager.js";
import type { ISessionStateReader } from "./interfaces/session-state-reader.js";
import type { ISessionStateWriter } from "./interfaces/session-state-writer.js";

let SessionConnectionManager: typeof import("./session-connection-manager.js").SessionConnectionManager;

const resumeSession = vi.fn();
const newSession = vi.fn();
const closeSession = vi.fn();
const setMode = vi.fn();
const setExecutionProfile = vi.fn();
const setModel = vi.fn();
const stopStreaming = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		closeSession,
		newSession,
		resumeSession,
		setMode,
		setExecutionProfile,
		setModel,
		stopStreaming,
	},
}));

const getSessionModelForMode = vi.fn();
const setSessionModelForMode = vi.fn();
const updateModelsCache = vi.fn();
const updateModelsDisplayCache = vi.fn();
const updateModesCache = vi.fn();
const getDefaultModel = vi.fn();
const ensureLoaded = vi.fn();
const isSessionModelLoaded = vi.fn();
const getCachedModels = vi.fn().mockReturnValue([]);

vi.mock("../agent-model-preferences-store.svelte.js", () => ({
	getSessionModelForMode,
	setSessionModelForMode,
	updateModelsCache,
	updateModelsDisplayCache,
	updateModesCache,
	getDefaultModel,
	ensureLoaded,
	isSessionModelLoaded,
	getCachedModels,
}));

function createMockEventHandler(): SessionEventHandler {
	return {
		getSessionCold: vi.fn(),
		isPreloaded: vi.fn(),
		getEntries: vi.fn(),
		getHotState: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		aggregateUserChunk: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		updateAvailableCommands: vi.fn(),
		ensureStreamingState: vi.fn(),
		handleStreamEntry: vi.fn(),
		handleStreamComplete: vi.fn(),
		handleTurnError: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
		updateCurrentMode: vi.fn(),
		updateConfigOptions: vi.fn(),
		updateUsageTelemetry: vi.fn(),
	};
}

function createManager(deps: {
	stateReader: ISessionStateReader;
	stateWriter: ISessionStateWriter;
	hotState: IHotStateManager;
	capabilities: ICapabilitiesManager;
	entryManager: IEntryManager;
	connectionManager: IConnectionManager;
}) {
	return new SessionConnectionManager(
		deps.stateReader,
		deps.stateWriter,
		deps.hotState,
		deps.capabilities,
		deps.entryManager,
		deps.connectionManager,
		new SessionEventService()
	);
}

describe("SessionConnectionManager.connectSession", () => {
	const sessionId = "session-1";
	const projectPath = "/tmp/project";
	const agentId = "opencode";

	const baseSession: SessionCold = {
		id: sessionId,
		projectPath,
		agentId,
		title: "Test",
		updatedAt: new Date(),
		createdAt: new Date(),
		parentId: null,
	};

	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: IHotStateManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: ICapabilitiesManager = {
		getCapabilities: vi.fn(),
		hasCapabilities: vi.fn(),
		updateCapabilities: vi.fn(),
		removeCapabilities: vi.fn(),
	};

	const entryManager: IEntryManager = {
		getEntries: vi.fn(),
		hasEntries: vi.fn(),
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		unmarkPreloaded: vi.fn(),
		storeEntriesAndBuildIndex: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		updateEntry: vi.fn(),
		clearEntries: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
			finalizeStreamingEntries: vi.fn(),
	};

	const connectionManager: IConnectionManager = {
		createOrGetMachine: vi.fn(),
		getMachine: vi.fn(),
		getState: vi.fn(),
		removeMachine: vi.fn(),
		isConnecting: vi.fn(),
		setConnecting: vi.fn(),
		sendContentLoad: vi.fn(),
		sendContentLoaded: vi.fn(),
		sendContentLoadError: vi.fn(),
		sendConnectionConnect: vi.fn(),
		sendConnectionSuccess: vi.fn(),
		sendCapabilitiesLoaded: vi.fn(),
		sendConnectionError: vi.fn(),
		sendTurnFailed: vi.fn(),
		sendDisconnect: vi.fn(),
		sendMessageSent: vi.fn(),
		sendResponseStarted: vi.fn(),
		sendResponseComplete: vi.fn(),
		initializeConnectedSession: vi.fn(),
	};

	beforeAll(async () => {
		const module = await import("./session-connection-manager.js");
		SessionConnectionManager = module.SessionConnectionManager;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(baseSession);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
		});
		(connectionManager.isConnecting as ReturnType<typeof vi.fn>).mockReturnValue(false);
		ensureLoaded.mockReturnValue(okAsync(undefined));
		isSessionModelLoaded.mockReturnValue(true);
		setExecutionProfile.mockReturnValue(okAsync(undefined));
		resumeSession.mockReturnValue(
			okAsync({
				modes: {
					currentModeId: "plan",
					availableModes: [{ id: "plan", name: "Plan", description: null }],
				},
				models: {
					currentModelId: "model-a",
					availableModels: [
						{ modelId: "model-a", name: "Model A", description: null },
						{ modelId: "model-b", name: "Model B", description: null },
					],
				},
				availableCommands: [{ name: "compact", description: "Compact session" }],
			})
		);
		setModel.mockReturnValue(okAsync(undefined));
	});

	it("skips resume when ACP session is already bound for the thread", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			acpSessionId: sessionId,
		});

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(resumeSession).not.toHaveBeenCalled();
		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				isConnected: true,
				status: "ready",
				connectionError: null,
			})
		);
	});

	it("applies the stored Autonomous profile after reconnecting a disconnected session", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentMode: { id: "build", name: "Build", description: null },
		});

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(setExecutionProfile).toHaveBeenCalledWith(sessionId, "plan", true);
		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				autonomousEnabled: true,
				isConnected: true,
				status: "ready",
			})
		);
	});

	it("launches Claude reconnects with Autonomous execution profile instead of applying it live", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath,
			agentId: "claude-code",
			title: "Claude Thread",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentMode: { id: "build", name: "Build", description: null },
		});
		resumeSession.mockReturnValue(
			okAsync({
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "model-a",
					availableModels: [{ modelId: "model-a", name: "Model A", description: null }],
				},
				availableCommands: [],
			})
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(sessionId, projectPath, "claude-code", {
			modeId: "build",
			autonomousEnabled: true,
		});
		expect(setExecutionProfile).not.toHaveBeenCalled();
	});

	it("restores stored model for current mode on connect", async () => {
		getSessionModelForMode.mockReturnValue("model-b");

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(setModel).toHaveBeenCalledWith(sessionId, "model-b");

		const lastUpdate = (hotState.updateHotState as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
		expect(lastUpdate?.currentModel?.id).toBe("model-b");
	});

	it("resumes session in worktree cwd when worktreePath is set", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			...baseSession,
			worktreePath: "/tmp/project/.worktrees/feature-a",
		} satisfies SessionCold);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			"/tmp/project",
			agentId,
			undefined
		);
	});

	it("seeds session model-per-mode when none stored", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(setModel).not.toHaveBeenCalled();
		expect(setSessionModelForMode).toHaveBeenCalledWith(sessionId, "plan", "model-a");
	});

	it("does not seed session model when session model store not loaded", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		isSessionModelLoaded.mockReturnValue(false);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(setSessionModelForMode).not.toHaveBeenCalled();
	});

	it("keeps ACP model when restoring stored model fails", async () => {
		getSessionModelForMode.mockReturnValue("model-b");
		setModel.mockReturnValue(errAsync(new Error("boom")));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		const lastUpdate = (hotState.updateHotState as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
		expect(lastUpdate?.currentModel?.id).toBe("model-a");
	});

	it("transitions content state machine to LOADED on successful connect", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(connectionManager.sendContentLoad).toHaveBeenCalledWith(sessionId);
		expect(connectionManager.sendContentLoaded).toHaveBeenCalledWith(sessionId);
	});

	it("stores available commands from resume response", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		const capabilitiesUpdate = (capabilities.updateCapabilities as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(capabilitiesUpdate?.availableCommands).toEqual([
			{ name: "compact", description: "Compact session" },
		]);
	});

	it("hydrates hot state with available commands on connect", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		const lastUpdate = (hotState.updateHotState as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
		expect(lastUpdate?.availableCommands).toEqual([
			{ name: "compact", description: "Compact session" },
		]);
	});

	it("flushes pending events after successful connect", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		const flushSpy = vi.spyOn(SessionEventService.prototype, "flushPendingEvents");
		const eventHandler = createMockEventHandler();

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, eventHandler);
		result._unsafeUnwrap();

		expect(flushSpy).toHaveBeenCalledWith(sessionId, eventHandler);
		flushSpy.mockRestore();
	});

	it("suppresses replay when connecting a preloaded session", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		(stateReader.isPreloaded as ReturnType<typeof vi.fn>).mockReturnValue(true);
		const suppressSpy = vi.spyOn(SessionEventService.prototype, "suppressReplayForSession");

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(suppressSpy).toHaveBeenCalledWith(sessionId);
		suppressSpy.mockRestore();
	});

	it("clears replay suppression when connecting a non-preloaded session", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		(stateReader.isPreloaded as ReturnType<typeof vi.fn>).mockReturnValue(false);
		const clearSpy = vi.spyOn(SessionEventService.prototype, "clearReplaySuppressionForSession");

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());
		result._unsafeUnwrap();

		expect(clearSpy).toHaveBeenCalledWith(sessionId);
		clearSpy.mockRestore();
	});

	it("clears replay suppression if connection fails", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		(stateReader.isPreloaded as ReturnType<typeof vi.fn>).mockReturnValue(true);
		resumeSession.mockReturnValue(errAsync(new Error("resume failed")));
		const clearSpy = vi.spyOn(SessionEventService.prototype, "clearReplaySuppressionForSession");

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler());

		expect(result.isErr()).toBe(true);
		expect(clearSpy).toHaveBeenCalledWith(sessionId);
		clearSpy.mockRestore();
	});
});

describe("SessionConnectionManager.createSession", () => {
	const sessionId = "session-new";
	const projectPath = "/tmp/project";
	const agentId = "codex";

	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: IHotStateManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: ICapabilitiesManager = {
		getCapabilities: vi.fn(),
		hasCapabilities: vi.fn(),
		updateCapabilities: vi.fn(),
		removeCapabilities: vi.fn(),
	};

	const entryManager: IEntryManager = {
		getEntries: vi.fn(),
		hasEntries: vi.fn(),
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		unmarkPreloaded: vi.fn(),
		storeEntriesAndBuildIndex: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		updateEntry: vi.fn(),
		clearEntries: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
			finalizeStreamingEntries: vi.fn(),
	};

	const connectionManager: IConnectionManager = {
		createOrGetMachine: vi.fn(),
		getMachine: vi.fn(),
		getState: vi.fn(),
		removeMachine: vi.fn(),
		isConnecting: vi.fn(),
		setConnecting: vi.fn(),
		sendContentLoad: vi.fn(),
		sendContentLoaded: vi.fn(),
		sendContentLoadError: vi.fn(),
		sendConnectionConnect: vi.fn(),
		sendConnectionSuccess: vi.fn(),
		sendCapabilitiesLoaded: vi.fn(),
		sendConnectionError: vi.fn(),
		sendTurnFailed: vi.fn(),
		sendDisconnect: vi.fn(),
		sendMessageSent: vi.fn(),
		sendResponseStarted: vi.fn(),
		sendResponseComplete: vi.fn(),
		initializeConnectedSession: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		ensureLoaded.mockReturnValue(okAsync(undefined));
		getDefaultModel.mockReturnValue(undefined);
		setMode.mockReturnValue(okAsync(undefined));
		setExecutionProfile.mockReturnValue(okAsync(undefined));
		setModel.mockReturnValue(okAsync(undefined));
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "gpt-5.2-codex",
					availableModels: [
						{
							modelId: "gpt-5.2-codex/high",
							name: "gpt-5.2-codex (high)",
							description: null,
						},
						{
							modelId: "gpt-5.2-codex/medium",
							name: "gpt-5.2-codex (medium)",
							description: null,
						},
					],
				},
				availableCommands: [{ name: "open", description: "Open file" }],
			})
		);
	});

	it("falls back to a prefixed model variant when currentModelId has no exact match", async () => {
		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession({ projectPath, agentId }, createMockEventHandler());
		result._unsafeUnwrap();

		const addedSession = (stateWriter.addSession as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as SessionCold;
		// After the cold/hot split, currentModel is in hot state, not cold.
		// Verify cold data was stored correctly.
		expect(addedSession.id).toBe(sessionId);
		expect(addedSession.agentId).toBe(agentId);
		// Verify hot state was initialized with the resolved model
		const hotStateInit = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(hotStateInit?.currentModel?.id).toBe("gpt-5.2-codex/high");
	});

	it("stores available commands from new session response", async () => {
		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession({ projectPath, agentId }, createMockEventHandler());
		result._unsafeUnwrap();

		const capabilitiesUpdate = (capabilities.updateCapabilities as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(capabilitiesUpdate?.availableCommands).toEqual([
			{ name: "open", description: "Open file" },
		]);
	});

	it("hydrates hot state with available commands on new session", async () => {
		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession({ projectPath, agentId }, createMockEventHandler());
		result._unsafeUnwrap();

		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(initUpdate?.availableCommands).toEqual([{ name: "open", description: "Open file" }]);
	});

	it("stores sequenceId returned by the backend on the new cold session", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				sequenceId: 7,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "gpt-5.2-codex",
					availableModels: [
						{
							modelId: "gpt-5.2-codex/high",
							name: "gpt-5.2-codex (high)",
							description: null,
						},
					],
				},
				availableCommands: [],
			})
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession({ projectPath, agentId }, createMockEventHandler());
		result._unsafeUnwrap();

		const addedSession = (stateWriter.addSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
			SessionCold;
		expect(addedSession.sequenceId).toBe(7);
	});

	it("honors an explicit initial mode and model before first send state is hydrated", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [
						{ id: "build", name: "Build", description: null },
						{ id: "plan", name: "Plan", description: null },
					],
				},
				models: {
					currentModelId: "gpt-5.2-codex",
					availableModels: [
						{
							modelId: "gpt-5.2-codex/high",
							name: "gpt-5.2-codex (high)",
							description: null,
						},
						{
							modelId: "gpt-5.2-codex/medium",
							name: "gpt-5.2-codex (medium)",
							description: null,
						},
					],
				},
				availableCommands: [],
			})
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession(
			{
				projectPath,
				agentId,
				initialModeId: "plan",
				initialModelId: "gpt-5.2-codex/medium",
			},
			createMockEventHandler()
		);
		result._unsafeUnwrap();

		expect(setMode).toHaveBeenCalledWith(sessionId, "plan");
		expect(setModel).toHaveBeenCalledWith(sessionId, "gpt-5.2-codex/medium");

		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(initUpdate?.currentMode?.id).toBe("plan");
		expect(initUpdate?.currentModel?.id).toBe("gpt-5.2-codex/medium");
		expect(setSessionModelForMode).toHaveBeenCalledWith(
			sessionId,
			"plan",
			"gpt-5.2-codex/medium"
		);
	});

	it("applies the target mode default model when only the initial mode is explicit", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [
						{ id: "build", name: "Build", description: null },
						{ id: "plan", name: "Plan", description: null },
					],
				},
				models: {
					currentModelId: "gpt-5.2-codex",
					availableModels: [
						{
							modelId: "gpt-5.2-codex/high",
							name: "gpt-5.2-codex (high)",
							description: null,
						},
						{
							modelId: "gpt-5.2-codex/medium",
							name: "gpt-5.2-codex (medium)",
							description: null,
						},
					],
				},
				availableCommands: [],
			})
		);
		getDefaultModel.mockImplementation((_agentId: string, modeType: string) =>
			modeType === "plan" ? "gpt-5.2-codex/medium" : undefined
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession(
			{
				projectPath,
				agentId,
				initialModeId: "plan",
			},
			createMockEventHandler()
		);
		result._unsafeUnwrap();

		expect(setMode).toHaveBeenCalledWith(sessionId, "plan");
		expect(setModel).toHaveBeenCalledWith(sessionId, "gpt-5.2-codex/medium");

		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(initUpdate?.currentMode?.id).toBe("plan");
		expect(initUpdate?.currentModel?.id).toBe("gpt-5.2-codex/medium");
	});

	it("applies autonomous execution profile on create when requested before first send", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "gpt-5.2-codex",
					availableModels: [
						{
							modelId: "gpt-5.2-codex/high",
							name: "gpt-5.2-codex (high)",
							description: null,
						},
					],
				},
				availableCommands: [],
			})
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession(
			{
				projectPath,
				agentId,
				initialAutonomousEnabled: true,
			},
			createMockEventHandler()
		);
		result._unsafeUnwrap();

		expect(setExecutionProfile).toHaveBeenCalledWith(sessionId, "build", true);

		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(initUpdate?.autonomousEnabled).toBe(true);
	});
});

describe("SessionConnectionManager Autonomous execution profile", () => {
	const sessionId = "session-autonomous";
	const connectedSession: SessionCold = {
		id: sessionId,
		projectPath: "/tmp/project",
		agentId: "claude-code",
		title: "Autonomous",
		updatedAt: new Date(),
		createdAt: new Date(),
		parentId: null,
	};

	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: IHotStateManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: ICapabilitiesManager = {
		getCapabilities: vi.fn(),
		hasCapabilities: vi.fn(),
		updateCapabilities: vi.fn(),
		removeCapabilities: vi.fn(),
	};

	const entryManager: IEntryManager = {
		getEntries: vi.fn(),
		hasEntries: vi.fn(),
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		unmarkPreloaded: vi.fn(),
		storeEntriesAndBuildIndex: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		updateEntry: vi.fn(),
		clearEntries: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
			finalizeStreamingEntries: vi.fn(),
	};

	const connectionManager: IConnectionManager = {
		createOrGetMachine: vi.fn(),
		getMachine: vi.fn(),
		getState: vi.fn(),
		removeMachine: vi.fn(),
		isConnecting: vi.fn(),
		setConnecting: vi.fn(),
		sendContentLoad: vi.fn(),
		sendContentLoaded: vi.fn(),
		sendContentLoadError: vi.fn(),
		sendConnectionConnect: vi.fn(),
		sendConnectionSuccess: vi.fn(),
		sendCapabilitiesLoaded: vi.fn(),
		sendConnectionError: vi.fn(),
		sendTurnFailed: vi.fn(),
		sendDisconnect: vi.fn(),
		sendMessageSent: vi.fn(),
		sendResponseStarted: vi.fn(),
		sendResponseComplete: vi.fn(),
		initializeConnectedSession: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(connectedSession);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
			acpSessionId: sessionId,
			connectionError: null,
			autonomousEnabled: false,
			autonomousTransition: "idle" as const,
			currentModel: null,
			currentMode: { id: "build", name: "Build", description: null },
			availableCommands: [],
			modelPerMode: {},
			statusChangedAt: Date.now(),
		});
		(capabilities.getCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [
				{ id: "build", name: "Build", description: null },
				{ id: "plan", name: "Plan", description: null },
			],
			availableModels: [],
			availableCommands: [],
		});
		setExecutionProfile.mockReturnValue(okAsync(undefined));
	});

	it("applies Autonomous only after the execution profile succeeds", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
			title: "Autonomous",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setAutonomousEnabled(sessionId, true);
		result._unsafeUnwrap();

		expect(setExecutionProfile).toHaveBeenCalledWith(sessionId, "build", true);
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(1, sessionId, {
			autonomousTransition: "enabling",
		});
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(2, sessionId, {
			autonomousEnabled: true,
			autonomousTransition: "idle",
		});
	});

	it("stores Autonomous locally when the session is disconnected", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			status: "idle",
			turnState: "idle",
			acpSessionId: null,
			connectionError: null,
			autonomousEnabled: false,
			autonomousTransition: "idle" as const,
			currentModel: null,
			currentMode: { id: "build", name: "Build", description: null },
			availableCommands: [],
			modelPerMode: {},
			statusChangedAt: Date.now(),
		});

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setAutonomousEnabled(sessionId, true);
		result._unsafeUnwrap();

		expect(setExecutionProfile).not.toHaveBeenCalled();
		expect(hotState.updateHotState).toHaveBeenCalledWith(sessionId, {
			autonomousEnabled: true,
			autonomousTransition: "idle",
		});
	});

	it("rolls Autonomous state back when execution profile apply fails", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
			title: "Autonomous",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		setExecutionProfile.mockReturnValue(
			errAsync(new AgentError("setExecutionProfile", new Error("backend failed")))
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setAutonomousEnabled(sessionId, true);
		expect(result.isErr()).toBe(true);

		expect(hotState.updateHotState).toHaveBeenNthCalledWith(1, sessionId, {
			autonomousTransition: "enabling",
		});
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(2, sessionId, {
			autonomousEnabled: false,
			autonomousTransition: "idle",
		});
	});

	it("reconnects Claude sessions to enable Autonomous instead of applying it live", async () => {
		const connectedHotState = {
			isConnected: true,
			status: "ready",
			turnState: "idle",
			acpSessionId: sessionId,
			connectionError: null,
			autonomousEnabled: false,
			autonomousTransition: "idle" as const,
			currentModel: null,
			currentMode: { id: "build", name: "Build", description: null },
			availableCommands: [],
			modelPerMode: {},
			statusChangedAt: Date.now(),
		};
		const reconnectingHotState = {
			isConnected: false,
			status: "idle",
			turnState: "idle",
			acpSessionId: null,
			connectionError: null,
			autonomousEnabled: true,
			autonomousTransition: "enabling" as const,
			currentModel: null,
			currentMode: { id: "build", name: "Build", description: null },
			availableCommands: [],
			modelPerMode: {},
			statusChangedAt: Date.now(),
		};
		let hotStateReadCount = 0;
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockImplementation(() => {
			hotStateReadCount += 1;
			return hotStateReadCount <= 2 ? connectedHotState : reconnectingHotState;
		});
		closeSession.mockReturnValue(okAsync(undefined));
		resumeSession.mockReturnValue(
			okAsync({
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "",
					availableModels: [],
				},
				availableCommands: [],
			})
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setAutonomousEnabled(sessionId, true, createMockEventHandler());
		expect(result.isOk()).toBe(true);

		expect(closeSession).toHaveBeenCalledWith(sessionId);
		expect(resumeSession).toHaveBeenCalledWith(sessionId, "/tmp/project", "claude-code", {
			modeId: "build",
			autonomousEnabled: true,
		});
		expect(setExecutionProfile).not.toHaveBeenCalled();
	});

	it("forces Autonomous off when a mode change is unsupported in autonomous mode", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
			acpSessionId: sessionId,
			connectionError: null,
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentModel: null,
			currentMode: { id: "build", name: "Build", description: null },
			availableCommands: [],
			modelPerMode: {},
			statusChangedAt: Date.now(),
		});
		setExecutionProfile
			.mockReturnValueOnce(
				errAsync(
					new AgentError(
						"setExecutionProfile",
						new Error(
							"unsupported autonomous execution profile: provider=claude-code ui_mode=plan autonomous=true"
						)
					)
				)
			)
			.mockReturnValueOnce(okAsync(undefined));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setMode(sessionId, "plan");
		result._unsafeUnwrap();

		expect(setExecutionProfile).toHaveBeenNthCalledWith(1, sessionId, "plan", true);
		expect(setExecutionProfile).toHaveBeenNthCalledWith(2, sessionId, "plan", false);
		expect(hotState.updateHotState).toHaveBeenCalledWith(sessionId, {
			autonomousEnabled: false,
		});
	});
});

describe("SessionConnectionManager.cancelStreaming", () => {
	const sessionId = "session-cancel";

	const connectedSession: SessionCold = {
		id: sessionId,
		projectPath: "/tmp/project",
		agentId: "opencode",
		title: "Test",
		updatedAt: new Date(),
		createdAt: new Date(),
		parentId: null,
	};

	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: IHotStateManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: ICapabilitiesManager = {
		getCapabilities: vi.fn(),
		hasCapabilities: vi.fn(),
		updateCapabilities: vi.fn(),
		removeCapabilities: vi.fn(),
	};

	const entryManager: IEntryManager = {
		getEntries: vi.fn(),
		hasEntries: vi.fn(),
		isPreloaded: vi.fn(),
		markPreloaded: vi.fn(),
		unmarkPreloaded: vi.fn(),
		storeEntriesAndBuildIndex: vi.fn(),
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		updateEntry: vi.fn(),
		clearEntries: vi.fn(),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		aggregateAssistantChunk: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
			finalizeStreamingEntries: vi.fn(),
	};

	const connectionManager: IConnectionManager = {
		createOrGetMachine: vi.fn(),
		getMachine: vi.fn(),
		getState: vi.fn(),
		removeMachine: vi.fn(),
		isConnecting: vi.fn(),
		setConnecting: vi.fn(),
		sendContentLoad: vi.fn(),
		sendContentLoaded: vi.fn(),
		sendContentLoadError: vi.fn(),
		sendConnectionConnect: vi.fn(),
		sendConnectionSuccess: vi.fn(),
		sendCapabilitiesLoaded: vi.fn(),
		sendConnectionError: vi.fn(),
		sendTurnFailed: vi.fn(),
		sendDisconnect: vi.fn(),
		sendMessageSent: vi.fn(),
		sendResponseStarted: vi.fn(),
		sendResponseComplete: vi.fn(),
		initializeConnectedSession: vi.fn(),
	};

	beforeAll(async () => {
		const module = await import("./session-connection-manager.js");
		SessionConnectionManager = module.SessionConnectionManager;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(connectedSession);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			isStreaming: true,
			status: "idle",
		});
	});

	it("sends sendResponseComplete to transition machine STREAMING → READY on success", async () => {
		stopStreaming.mockReturnValue(okAsync(undefined));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.cancelStreaming(sessionId);
		result._unsafeUnwrap();

		expect(connectionManager.sendResponseComplete).toHaveBeenCalledWith(sessionId);
		expect(hotState.updateHotState).toHaveBeenCalledWith(sessionId, {
			status: "ready",
			turnState: "interrupted",
		});
	});

	it("does not send machine event when API call fails", async () => {
		stopStreaming.mockReturnValue(errAsync(new Error("network error")));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.cancelStreaming(sessionId);
		expect(result.isErr()).toBe(true);

		expect(connectionManager.sendResponseComplete).not.toHaveBeenCalled();
		expect(hotState.updateHotState).not.toHaveBeenCalled();
	});
});

describe("SessionConnectionManager.disconnectSession", () => {
	it("clears available commands when disconnecting a session", async () => {
		const sessionId = "session-disconnect";
		const stateReader: ISessionStateReader = {
			getHotState: vi.fn((): SessionHotState => ({
				isConnected: true,
				status: "ready" as const,
				turnState: "idle" as const,
				acpSessionId: "acp-1",
				connectionError: null,
				autonomousEnabled: false,
				autonomousTransition: "idle",
				currentModel: null,
				currentMode: null,
				availableCommands: [{ name: "open", description: "Open file" }],
				modelPerMode: {},
				statusChangedAt: Date.now(),
			})),
			getEntries: vi.fn(() => []),
			isPreloaded: vi.fn(() => false),
			getSessionsForProject: vi.fn(() => []),
			getSessionCold: vi.fn(() => ({
				id: sessionId,
				projectPath: "/tmp/project",
				agentId: "opencode",
				title: "Test",
				updatedAt: new Date(),
				createdAt: new Date(),
				parentId: null,
			})),
			getAllSessions: vi.fn(() => []),
		};

		const stateWriter: ISessionStateWriter = {
			addSession: vi.fn(),
			updateSession: vi.fn(),
			removeSession: vi.fn(),
			setSessions: vi.fn(),
			setLoading: vi.fn(),
			addScanningProjects: vi.fn(),
			removeScanningProjects: vi.fn(),
		};

		const hotState: IHotStateManager = {
			getHotState: vi.fn(),
			hasHotState: vi.fn(),
			updateHotState: vi.fn(),
			removeHotState: vi.fn(),
			initializeHotState: vi.fn(),
		};

		const capabilities: ICapabilitiesManager = {
			getCapabilities: vi.fn(),
			hasCapabilities: vi.fn(),
			updateCapabilities: vi.fn(),
			removeCapabilities: vi.fn(),
		};

		const entryManager: IEntryManager = {
			getEntries: vi.fn(),
			hasEntries: vi.fn(),
			isPreloaded: vi.fn(),
			markPreloaded: vi.fn(),
			unmarkPreloaded: vi.fn(),
			storeEntriesAndBuildIndex: vi.fn(),
			addEntry: vi.fn(),
			removeEntry: vi.fn(),
			updateEntry: vi.fn(),
			clearEntries: vi.fn(),
			createToolCallEntry: vi.fn(),
			updateToolCallEntry: vi.fn(),
			aggregateAssistantChunk: vi.fn(),
			clearStreamingAssistantEntry: vi.fn(),
			finalizeStreamingEntries: vi.fn(),
		};

		const connectionManager: IConnectionManager = {
			createOrGetMachine: vi.fn(),
			getMachine: vi.fn(),
			getState: vi.fn(),
			removeMachine: vi.fn(),
			isConnecting: vi.fn(),
			setConnecting: vi.fn(),
			sendContentLoad: vi.fn(),
			sendContentLoaded: vi.fn(),
			sendContentLoadError: vi.fn(),
			sendConnectionConnect: vi.fn(),
			sendConnectionSuccess: vi.fn(),
			sendCapabilitiesLoaded: vi.fn(),
			sendConnectionError: vi.fn(),
			sendTurnFailed: vi.fn(),
			sendDisconnect: vi.fn(),
			sendMessageSent: vi.fn(),
			sendResponseStarted: vi.fn(),
			sendResponseComplete: vi.fn(),
			initializeConnectedSession: vi.fn(),
		};

		closeSession.mockReturnValue(okAsync(undefined));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		manager.disconnectSession(sessionId);

		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				availableCommands: [],
				isConnected: false,
			})
		);
	});
});
