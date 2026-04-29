import { errAsync, okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModelState } from "../../../services/acp-types.js";
import type {
	AvailableCommand,
	ConfigOptionData,
} from "../../../services/converted-session-types.js";
import { TauriCommandError } from "../../../utils/tauri-client/invoke.js";
import { AgentError, CreationFailureError } from "../../errors/app-error.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import type { ConnectionCompleteData } from "../session-event-service.svelte.js";
import { SessionEventService } from "../session-event-service.svelte.js";
import type { SessionCapabilities, SessionCold, SessionTransientProjection } from "../types.js";
import type { IConnectionManager } from "./interfaces/connection-manager.js";
import type { IEntryManager } from "./interfaces/entry-manager.js";
import type { ISessionStateReader } from "./interfaces/session-state-reader.js";
import type { ISessionStateWriter } from "./interfaces/session-state-writer.js";
import type { ITransientProjectionManager } from "./interfaces/transient-projection-manager.js";

let SessionConnectionManager: typeof import("./session-connection-manager.js").SessionConnectionManager;

interface TestCanonicalCapabilities {
	readCapabilities(sessionId: string): SessionCapabilities;
	hasCanonicalCapabilities(sessionId: string): boolean;
	recordCapabilityUpdate(sessionId: string, updates: Partial<SessionCapabilities>): void;
	removeCanonicalCapabilities(sessionId: string): void;
}

const canonicalOverlapHotStateFields = [
	"status",
	"isConnected",
	"turnState",
	"activity",
	"connectionError",
	"activeTurnFailure",
	"lastTerminalTurnId",
	"currentModel",
	"currentMode",
	"availableCommands",
	"availableModels",
	"availableModes",
	"autonomousEnabled",
	"configOptions",
	"providerMetadata",
	"modelsDisplay",
] as const;

function createResidualHotState(input: {
	acpSessionId?: string | null;
	autonomousTransition?: SessionTransientProjection["autonomousTransition"];
	modelPerMode?: Record<string, string>;
} = {}): SessionTransientProjection {
	return {
		acpSessionId: input.acpSessionId ?? null,
		autonomousTransition: input.autonomousTransition ?? "idle",
		modelPerMode: input.modelPerMode ?? {},
		statusChangedAt: Date.now(),
		pendingSendIntent: null,
		localPersistedSessionProbeStatus: "none",
		capabilityMutationState: {
			pendingMutationId: null,
			previewState: null,
		},
	};
}

function expectNoCanonicalOverlapHotStateWrites(updateHotState: ReturnType<typeof vi.fn>): void {
	for (const call of updateHotState.mock.calls) {
		const updates = call[1];
		for (const field of canonicalOverlapHotStateFields) {
			expect(Object.prototype.hasOwnProperty.call(updates, field)).toBe(false);
		}
	}
}

const resumeSession = vi.fn();
const newSession = vi.fn();
const closeSession = vi.fn();
const setMode = vi.fn();
const setSessionAutonomous = vi.fn();
const setModel = vi.fn();
const setConfigOption = vi.fn();
const stopStreaming = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		closeSession,
		newSession,
		resumeSession,
		setMode,
		setSessionAutonomous,
		setModel,
		setConfigOption,
		stopStreaming,
	},
}));

const getSessionModelForMode = vi.fn();
const setSessionModelForMode = vi.fn();
const updateModelsCache = vi.fn();
const updateModelsDisplayCache = vi.fn();
const updateModesCache = vi.fn();
const getDefaultModel = vi.fn();
const getCachedModelsDisplay = vi.fn();
const getCachedProviderMetadata = vi.fn();
const ensureLoaded = vi.fn();
const isSessionModelLoaded = vi.fn();
const getCachedModels = vi.fn().mockReturnValue([]);
const updateProviderMetadataCache = vi.fn();

vi.mock("../agent-model-preferences-store.svelte.js", () => ({
	getSessionModelForMode,
	setSessionModelForMode,
	updateModelsCache,
	updateModelsDisplayCache,
	updateProviderMetadataCache,
	updateModesCache,
	getDefaultModel,
	getCachedModelsDisplay,
	getCachedProviderMetadata,
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
		ensureStreamingState: vi.fn(),
		handleStreamEntry: vi.fn(),
		handleStreamComplete: vi.fn(),
		handleTurnError: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
		updateUsageTelemetry: vi.fn(),
		applySessionStateEnvelope: vi.fn(),
	};
}

let lastEventService: SessionEventService;
let nextLifecycleResult: ConnectionCompleteData;

beforeAll(async () => {
	const modulePath = "./session-connection-manager.js?session-connection-manager-test" as string;
	const module = (await import(modulePath)) as typeof import("./session-connection-manager.js");
	SessionConnectionManager = module.SessionConnectionManager;
});

function createManager(deps: {
	stateReader: ISessionStateReader;
	stateWriter: ISessionStateWriter;
	hotState: ITransientProjectionManager;
	capabilities: TestCanonicalCapabilities;
	entryManager: IEntryManager;
	connectionManager: IConnectionManager;
}) {
	lastEventService = new SessionEventService();
	vi.spyOn(lastEventService, "waitForConnectionMaterialization").mockImplementation(() => ({
		promise: Promise.resolve(nextLifecycleResult),
		cancel: vi.fn(),
	}));
	if (deps.stateReader.getSessionCapabilities === undefined) {
		Object.assign(deps.stateReader, { getSessionCapabilities: vi.fn() });
	}
	(deps.stateReader.getSessionCapabilities as ReturnType<typeof vi.fn>).mockImplementation(
		(sessionId: string) => deps.capabilities.readCapabilities(sessionId)
	);
	return new SessionConnectionManager(
		deps.stateReader,
		deps.stateWriter,
		deps.hotState,
		deps.entryManager,
		deps.connectionManager,
		lastEventService
	);
}

/**
 * Configure the resumeSession mock to return void and schedule a
 * connectionComplete lifecycle event through the event service update handler.
 * This simulates the fire-and-forget invoke + SSE lifecycle event pattern.
 */
function mockResumeWithLifecycleEvent(responseData: {
	modes: {
		currentModeId: string;
		availableModes: Array<{ id: string; name: string; description: string | null }>;
	};
	models: SessionModelState;
	availableCommands?: AvailableCommand[];
	configOptions?: ConfigOptionData[];
	autonomousEnabled?: boolean;
}) {
	nextLifecycleResult = {
		models: responseData.models,
		modes: responseData.modes,
		availableCommands: responseData.availableCommands ?? [],
		configOptions: responseData.configOptions ?? [],
		autonomousEnabled: responseData.autonomousEnabled ?? false,
	};
	resumeSession.mockReturnValue(okAsync(undefined));
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
		getSessionCanSend: vi.fn(),
		getSessionLifecycleStatus: vi.fn(),
		getSessionAutonomousEnabled: vi.fn(),
		getSessionCurrentModeId: vi.fn(),
		getSessionCapabilities: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		replaceSessionOpenSnapshot: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: ITransientProjectionManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: TestCanonicalCapabilities = {
		readCapabilities: vi.fn(),
		hasCanonicalCapabilities: vi.fn(),
		recordCapabilityUpdate: vi.fn(),
		removeCanonicalCapabilities: vi.fn(),
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
		startNewAssistantTurn: vi.fn(),
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
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(baseSession);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		(stateReader.getSessionCanSend as ReturnType<typeof vi.fn>).mockReturnValue(false);
		(stateReader.getSessionLifecycleStatus as ReturnType<typeof vi.fn>).mockReturnValue(null);
		(stateReader.getSessionAutonomousEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
		(stateReader.getSessionCurrentModeId as ReturnType<typeof vi.fn>).mockReturnValue(null);
		(connectionManager.isConnecting as ReturnType<typeof vi.fn>).mockReturnValue(false);
		ensureLoaded.mockReturnValue(okAsync(undefined));
		isSessionModelLoaded.mockReturnValue(true);
		getCachedModelsDisplay.mockReturnValue(null);
		getCachedProviderMetadata.mockReturnValue(undefined);
		setSessionAutonomous.mockReturnValue(okAsync(undefined));
		mockResumeWithLifecycleEvent({
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
		});
		setModel.mockReturnValue(okAsync(undefined));
	});

	it("applies the stored Autonomous profile after reconnecting a disconnected session", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "model-a",
				availableModels: [
					{ modelId: "model-a", name: "Model A", description: null },
					{ modelId: "model-b", name: "Model B", description: null },
				],
			},
			availableCommands: [{ name: "compact", description: "Compact session" }],
			autonomousEnabled: true,
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

		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("does not mutate historical content while attaching transport to a hydrated session", async () => {
		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			openToken: "open-token-1",
		});
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			"open-token-1"
		);
		expect(stateWriter.replaceSessionOpenSnapshot).not.toHaveBeenCalled();
		expect(entryManager.storeEntriesAndBuildIndex).not.toHaveBeenCalled();
		expect(entryManager.clearEntries).not.toHaveBeenCalled();
		expect(entryManager.createToolCallEntry).not.toHaveBeenCalled();
		expect(entryManager.updateToolCallEntry).not.toHaveBeenCalled();
		expect(connectionManager.sendContentLoad).not.toHaveBeenCalled();
		expect(connectionManager.sendContentLoaded).not.toHaveBeenCalled();
	});

	it("re-syncs autonomous policy after reconnecting a disconnected session", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath,
			agentId: "custom-agent",
			title: "Launch Profile Thread",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "model-a",
				availableModels: [{ modelId: "model-a", name: "Model A", description: null }],
			},
			availableCommands: [],
			autonomousEnabled: true,
		});
		getCachedProviderMetadata.mockReturnValue({
			providerBrand: "custom",
			displayName: "Launch Profile Agent",
			displayOrder: 10,
			supportsModelDefaults: false,
			variantGroup: "plain",
			defaultAlias: undefined,
			reasoningEffortSupport: false,
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

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			undefined
		);
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("does not treat the hydrated current mode as a launch profile when reconnecting a session", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "plan",
				availableModes: [{ id: "plan", name: "Plan", description: null }],
			},
			models: {
				currentModelId: "model-a",
				availableModels: [{ modelId: "model-a", name: "Model A", description: null }],
			},
			availableCommands: [],
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

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			undefined
		);
	});

	it("clears Autonomous when reconnecting into a mode that does not support it", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "plan",
				availableModes: [{ id: "plan", name: "Plan", description: null }],
			},
			models: {
				currentModelId: "model-a",
				availableModels: [{ modelId: "model-a", name: "Model A", description: null }],
			},
			availableCommands: [],
			autonomousEnabled: false,
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

		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("ignores cached provider metadata when restoring autonomous policy on reconnect", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			...baseSession,
			agentId: "custom-agent",
		} satisfies SessionCold);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		getCachedModelsDisplay.mockReturnValue({
			groups: [],
			presentation: {
				displayFamily: "providerGrouped",
				usageMetrics: "spendAndContext",
				provider: {
					providerBrand: "custom",
					displayName: "Misleading display projection",
					displayOrder: 10,
					supportsModelDefaults: false,
					variantGroup: "plain",
					defaultAlias: undefined,
					reasoningEffortSupport: false,
				},
			},
		});
		getCachedProviderMetadata.mockReturnValue({
			providerBrand: "custom",
			displayName: "Launch Profile Agent",
			displayOrder: 10,
			supportsModelDefaults: false,
			variantGroup: "plain",
			defaultAlias: undefined,
			reasoningEffortSupport: false,
		});
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "model-a",
				availableModels: [
					{ modelId: "model-a", name: "Model A", description: null },
					{ modelId: "model-b", name: "Model B", description: null },
				],
			},
			availableCommands: [{ name: "compact", description: "Compact session" }],
			autonomousEnabled: true,
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

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			undefined
		);
		expect(updateProviderMetadataCache).toHaveBeenCalledWith(
			"custom-agent",
			expect.objectContaining({
				displayName: "Launch Profile Agent",
			})
		);
	});

	it("uses the lifecycle event model for current mode on connect", async () => {
		getSessionModelForMode.mockReturnValue("model-b");
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "plan",
				availableModes: [{ id: "plan", name: "Plan", description: null }],
			},
			models: {
				currentModelId: "model-b",
				availableModels: [
					{ modelId: "model-a", name: "Model A", description: null },
					{ modelId: "model-b", name: "Model B", description: null },
				],
			},
			availableCommands: [{ name: "compact", description: "Compact session" }],
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

		expect(setModel).not.toHaveBeenCalled();
		expect(updateModelsCache).toHaveBeenCalledWith(agentId, [
			{ id: "model-a", name: "Model A", description: undefined },
			{ id: "model-b", name: "Model B", description: undefined },
		]);
	});

	it("resumes session from the stable project cwd without a frontend agent override", async () => {
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
			expect.any(Number),
			undefined,
			undefined,
			undefined
		);
	});

	it("passes through an explicit agent override when reconnect is intentionally redirected", async () => {
		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			agentOverrideId: "claude-code",
		});
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			"claude-code",
			undefined,
			undefined
		);
	});

	it("caches resumed capabilities under the effective override agent", async () => {
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "default",
				availableModels: [{ modelId: "default", name: "Default", description: null }],
				providerMetadata: {
					providerBrand: "claude-code",
					displayName: "Claude Code",
					displayOrder: 10,
					supportsModelDefaults: true,
					variantGroup: "plain",
					defaultAlias: "default",
					reasoningEffortSupport: false,
					preconnectionSlashMode: "startupGlobal",
					preconnectionCapabilityMode: "startupGlobal",
				},
				modelsDisplay: {
					groups: [],
					presentation: {
						displayFamily: "claudeLike",
						usageMetrics: "contextWindowOnly",
					},
				},
			},
			availableCommands: [],
		});

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			agentOverrideId: "claude-code",
		});
		result._unsafeUnwrap();

		expect(updateModelsCache).toHaveBeenCalledWith("claude-code", [
			{ id: "default", name: "Default", description: undefined },
		]);
		expect(updateModelsDisplayCache).toHaveBeenCalledWith(
			"claude-code",
			expect.objectContaining({
				presentation: expect.objectContaining({
					provider: expect.objectContaining({
						providerBrand: "claude-code",
					}),
				}),
			}),
			expect.objectContaining({
				providerBrand: "claude-code",
			})
		);
		expect(updateProviderMetadataCache).toHaveBeenCalledWith(
			"claude-code",
			expect.objectContaining({
				providerBrand: "claude-code",
			})
		);
		expect(updateModesCache).toHaveBeenCalledWith("claude-code", [
			{ id: "build", name: "Build", description: undefined },
		]);
	});

	it("does not seed session model-per-mode during lifecycle-driven connect", async () => {
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
		expect(setSessionModelForMode).not.toHaveBeenCalled();
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

		expect(setModel).not.toHaveBeenCalled();
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

		expect(connectionManager.sendContentLoad).not.toHaveBeenCalled();
		expect(connectionManager.sendContentLoaded).not.toHaveBeenCalled();
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

		expect(capabilities.recordCapabilityUpdate).not.toHaveBeenCalled();
	});

	it("hydrates provider metadata into model display caches on connect", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			...baseSession,
			agentId: "codex",
		} satisfies SessionCold);
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "gpt-5.3-codex",
				availableModels: [
					{
						modelId: "gpt-5.3-codex/high",
						name: "gpt-5.3-codex (high)",
						description: null,
					},
				],
				modelsDisplay: {
					groups: [],
					presentation: {
						displayFamily: "providerGrouped",
						usageMetrics: "spendAndContext",
					},
				},
			},
			availableCommands: [],
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

		expect(updateModelsDisplayCache).toHaveBeenCalledWith(
			"codex",
			expect.objectContaining({
				presentation: expect.objectContaining({
					provider: expect.objectContaining({
						providerBrand: "codex",
						displayName: "Codex",
						displayOrder: 50,
						supportsModelDefaults: true,
						variantGroup: "reasoningEffort",
						reasoningEffortSupport: true,
					}),
				}),
			}),
			expect.objectContaining({
				providerBrand: "codex",
			})
		);
	});

	it("does not synthesize connection or capability hot state on connect", async () => {
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

		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("does not rely on reconnect-time pending event flush after lifecycle-driven connect completes", async () => {
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

		expect(flushSpy).not.toHaveBeenCalled();
		flushSpy.mockRestore();
	});

	it("passes the session open token through reconnect", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			openToken: "open-token-123",
		});
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			"open-token-123"
		);
	});

	// ==========================================================================
	// U7 E2E proof: delta-only reconnect after canonical open
	// ==========================================================================

	it("[E2E] reconnect after canonical open still invokes resumeSession with the openToken frontier", async () => {
		// Proof: reconnect always forwards the openToken boundary to Rust even when the
		// session already has an acpSessionId. Frontend replay suppression must never
		// short-circuit the reconnect invoke itself.
		getSessionModelForMode.mockReturnValue(undefined);

		// Simulate a session that was previously connected (has an acpSessionId in hot state).
		// The old replay-suppression guard would have skipped the resume call in this case.
		// Post-U5 this must always proceed to resumeSession.
		(hotState.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: "existing-acp-session-id" })
		);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			openToken: "open-token-post-snapshot",
		});
		result._unsafeUnwrap();

		// resumeSession MUST be called — no guard should short-circuit it just because
		// acpSessionId is already set. The reconnect frontier still belongs to the
		// openToken carried into Rust.
		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			"open-token-post-snapshot"
		);
	});

	it("[regression] open-token reconnect leaves replay suppression to Rust", async () => {
		getSessionModelForMode.mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.connectSession(sessionId, createMockEventHandler(), {
			openToken: "open-token-suppress-replay",
		});
		result._unsafeUnwrap();

		expect(resumeSession).toHaveBeenCalledWith(
			sessionId,
			projectPath,
			expect.any(Number),
			undefined,
			undefined,
			"open-token-suppress-replay"
		);
	});

	it("surfaces reconnect failures without translating them into resume-specific read-only copy", async () => {
		getSessionModelForMode.mockReturnValue(undefined);
		resumeSession.mockReturnValue(okAsync(undefined));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});
		vi.spyOn(lastEventService, "waitForConnectionMaterialization").mockImplementationOnce(() => ({
			promise: Promise.reject(new Error("Method not found: session/load")),
			cancel: vi.fn(),
		}));

		const result = await manager.connectSession(sessionId, createMockEventHandler());

		expect(result.isErr()).toBe(true);
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
		expect(connectionManager.sendConnectionError).toHaveBeenCalledWith(sessionId);
	});
});

describe("SessionConnectionManager.createSession", () => {
	const sessionId = "session-new";
	const projectPath = "/tmp/project";
	const agentId = "codex";

	const stateReader: ISessionStateReader = {
		getHotState: vi.fn(),
		getSessionCanSend: vi.fn(),
		getSessionLifecycleStatus: vi.fn(),
		getSessionAutonomousEnabled: vi.fn(),
		getSessionCurrentModeId: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		replaceSessionOpenSnapshot: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: ITransientProjectionManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: TestCanonicalCapabilities = {
		readCapabilities: vi.fn(),
		hasCanonicalCapabilities: vi.fn(),
		recordCapabilityUpdate: vi.fn(),
		removeCanonicalCapabilities: vi.fn(),
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
		startNewAssistantTurn: vi.fn(),
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
		getCachedModelsDisplay.mockReturnValue(null);
		getDefaultModel.mockReturnValue(undefined);
		setMode.mockReturnValue(okAsync(undefined));
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

	it("resolves grouped variant models from canonical display metadata when currentModelId is a base id", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "codex-enterprise",
					availableModels: [
						{
							modelId: "vendor/codex-enterprise/high",
							name: "codex-enterprise (high)",
							description: null,
						},
						{
							modelId: "vendor/codex-enterprise/medium",
							name: "codex-enterprise (medium)",
							description: null,
						},
					],
					modelsDisplay: {
						groups: [
							{
								label: "Codex enterprise",
								models: [
									{
										modelId: "vendor/codex-enterprise/high",
										displayName: "High",
										description: null,
									},
									{
										modelId: "vendor/codex-enterprise/medium",
										displayName: "Medium",
										description: null,
									},
								],
							},
						],
						presentation: {
							displayFamily: "codexReasoningEffort",
							usageMetrics: "spendAndContext",
							provider: {
								providerBrand: "codex",
								displayName: "Codex",
								displayOrder: 50,
								supportsModelDefaults: true,
								variantGroup: "reasoningEffort",
								defaultAlias: undefined,
								reasoningEffortSupport: true,
							},
						},
					},
				},
				availableCommands: [{ name: "open", description: "Open file" }],
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

		const addedSession = (stateWriter.addSession as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as SessionCold;
		expect(addedSession.id).toBe(sessionId);
		expect(addedSession.agentId).toBe(agentId);
		const hotStateInit = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(hotStateInit?.modelPerMode?.build).toBe("vendor/codex-enterprise/high");
	});

	it("resolves grouped variants from display model ids instead of matching display labels", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "vendor/codex-enterprise",
					availableModels: [
						{
							modelId: "vendor/codex-pro/high",
							name: "codex-pro (high)",
							description: null,
						},
						{
							modelId: "vendor/codex-enterprise/high",
							name: "codex-enterprise (high)",
							description: null,
						},
					],
					modelsDisplay: {
						groups: [
							{
								label: "GPT-5 Pro",
								models: [
									{
										modelId: "vendor/codex-pro/high",
										displayName: "High",
										description: null,
									},
								],
							},
							{
								label: "GPT-5 Enterprise",
								models: [
									{
										modelId: "vendor/codex-enterprise/high",
										displayName: "High",
										description: null,
									},
								],
							},
						],
						presentation: {
							displayFamily: "codexReasoningEffort",
							usageMetrics: "spendAndContext",
						},
					},
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

		const hotStateInit = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(hotStateInit?.modelPerMode?.build).toBe("vendor/codex-enterprise/high");
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

		expect(capabilities.recordCapabilityUpdate).not.toHaveBeenCalled();
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
		expect(Object.prototype.hasOwnProperty.call(initUpdate, "availableCommands")).toBe(false);
	});

	it("keeps a newly created session disconnected until canonical connect materializes readiness", async () => {
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
		expect(initUpdate).toMatchObject({
			modelPerMode: {
				build: "gpt-5.2-codex/high",
			},
		});
		expect(connectionManager.initializeConnectedSession).not.toHaveBeenCalled();
	});

	it("keeps deferred creation attempt out of the session store until promotion", async () => {
		newSession.mockReturnValue(
			okAsync({
				sessionId: "provider-requested-id",
				creationAttemptId: "attempt-1",
				deferredCreation: true,
				modes: {
					currentModeId: "build",
					availableModes: [{ id: "build", name: "Build", description: null }],
				},
				models: {
					currentModelId: "claude-sonnet-4.6",
					availableModels: [
						{
							modelId: "claude-sonnet-4.6",
							name: "Claude Sonnet 4.6",
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
		const created = result._unsafeUnwrap();

		expect(created).toEqual({
			kind: "pending",
			sessionId: "provider-requested-id",
			creationAttemptId: "attempt-1",
			projectPath,
			agentId,
			title: null,
			worktreePath: null,
		});
		expect(stateWriter.addSession).not.toHaveBeenCalled();
		expect(hotState.initializeHotState).toHaveBeenCalledWith("provider-requested-id");
		expect(entryManager.markPreloaded).not.toHaveBeenCalled();
	});

	it("surfaces typed backend creation failures without adding a local session", async () => {
		newSession.mockReturnValue(
			errAsync(
				new TauriCommandError({
					commandName: "acp_new_session",
					classification: "expected",
					backendCorrelationId: "correlation-1",
					message: "Provider failed before creating a session id",
					domain: {
						type: "acp",
						data: {
							type: "creation_failed",
							data: {
								kind: "provider_failed_before_id",
								message: "Provider failed before creating a session id",
								sessionId: null,
								creationAttemptId: "attempt-1",
								retryable: true,
							},
						},
					},
				})
			)
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

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(CreationFailureError);
		if (!(error instanceof CreationFailureError)) {
			throw new Error("Expected CreationFailureError");
		}
		expect(error.kind).toBe("provider_failed_before_id");
		expect(error.creationAttemptId).toBe("attempt-1");
		expect(error.retryable).toBe(true);
		expect(stateWriter.addSession).not.toHaveBeenCalled();
		expect(hotState.initializeHotState).not.toHaveBeenCalled();
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

		const addedSession = (stateWriter.addSession as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as SessionCold;
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
		expect(initUpdate?.modelPerMode?.plan).toBe("gpt-5.2-codex/medium");
		expect(setSessionModelForMode).toHaveBeenCalledWith(sessionId, "plan", "gpt-5.2-codex/medium");
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
		expect(initUpdate?.modelPerMode?.plan).toBe("gpt-5.2-codex/medium");
	});

	it("keeps the created session when explicit initial mode setup fails after backend session creation", async () => {
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
					currentModelId: "gpt-5.2-codex/high",
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
		setMode.mockReturnValue(errAsync(new AgentError("setMode", new Error("backend failed"))));

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
		expect(stateWriter.addSession).toHaveBeenCalled();
		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(initUpdate?.modelPerMode?.build).toBe("gpt-5.2-codex/high");
	});

	it("returns the freshly created cold session even if the stateReader lookup has not caught up yet", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.createSession({ projectPath, agentId }, createMockEventHandler());
		const created = result._unsafeUnwrap();
		expect(created.kind).toBe("ready");
		if (created.kind !== "ready") {
			throw new Error("Expected ready session creation");
		}
		const session = created.session;

		expect(stateWriter.addSession).toHaveBeenCalled();
		expect(session).toEqual(
			expect.objectContaining({
				id: sessionId,
				projectPath,
				agentId,
			})
		);
		expect(created.sessionOpen).toBeNull();
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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);

		const initUpdate = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
		expect(Object.prototype.hasOwnProperty.call(initUpdate, "autonomousEnabled")).toBe(false);
	});
});

describe("SessionConnectionManager autonomous policy", () => {
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
		getSessionCanSend: vi.fn(),
		getSessionLifecycleStatus: vi.fn(),
		getSessionAutonomousEnabled: vi.fn(),
		getSessionCurrentModeId: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		replaceSessionOpenSnapshot: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: ITransientProjectionManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: TestCanonicalCapabilities = {
		readCapabilities: vi.fn(),
		hasCanonicalCapabilities: vi.fn(),
		recordCapabilityUpdate: vi.fn(),
		removeCanonicalCapabilities: vi.fn(),
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
		startNewAssistantTurn: vi.fn(),
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
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionCanSend as ReturnType<typeof vi.fn>).mockReturnValue(true);
		(stateReader.getSessionLifecycleStatus as ReturnType<typeof vi.fn>).mockReturnValue("ready");
		(stateReader.getSessionAutonomousEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
		(stateReader.getSessionCurrentModeId as ReturnType<typeof vi.fn>).mockReturnValue("build");
		(capabilities.readCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [
				{ id: "build", name: "Build", description: null },
				{ id: "plan", name: "Plan", description: null },
			],
			availableModels: [],
			availableCommands: [],
		});
		setSessionAutonomous.mockReturnValue(okAsync(undefined));
	});

	it("syncs Autonomous after updating only local transition state", async () => {
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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(1, sessionId, {
			autonomousTransition: "enabling",
		});
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("syncs Autonomous for a disconnected session without storing local capability truth", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(createResidualHotState());
		(stateReader.getSessionCanSend as ReturnType<typeof vi.fn>).mockReturnValue(false);
		(stateReader.getSessionAutonomousEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
		(stateReader.getSessionCurrentModeId as ReturnType<typeof vi.fn>).mockReturnValue("build");

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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("rolls Autonomous state back when backend policy sync fails", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
			title: "Autonomous",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		setSessionAutonomous.mockReturnValue(
			errAsync(new AgentError("setSessionAutonomous", new Error("backend failed")))
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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(1, sessionId, {
			autonomousTransition: "enabling",
		});
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(2, sessionId, {
			autonomousTransition: "idle",
		});
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("does not reconnect sessions to enable Autonomous", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "custom-agent",
			title: "Launch Profile Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.readCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [],
			availableModels: [],
			availableCommands: [],
			providerMetadata: {
				providerBrand: "custom",
				displayName: "Launch Profile Agent",
				displayOrder: 10,
				supportsModelDefaults: false,
				variantGroup: "plain",
				defaultAlias: undefined,
				reasoningEffortSupport: false,
			},
			modelsDisplay: {
				groups: [],
				presentation: {
					displayFamily: "providerGrouped",
					usageMetrics: "spendAndContext",
					provider: {
						providerBrand: "custom",
						displayName: "Launch Profile Agent",
						displayOrder: 10,
						supportsModelDefaults: false,
						variantGroup: "plain",
						defaultAlias: undefined,
						reasoningEffortSupport: false,
					},
				},
			},
		});
		mockResumeWithLifecycleEvent({
			modes: {
				currentModeId: "build",
				availableModes: [{ id: "build", name: "Build", description: null }],
			},
			models: {
				currentModelId: "",
				availableModels: [],
			},
			availableCommands: [],
		});

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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);
		expect(closeSession).not.toHaveBeenCalled();
		expect(resumeSession).not.toHaveBeenCalled();
	});

	it("rejects Autonomous changes while a local transition is pending", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ autonomousTransition: "enabling" })
		);
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "custom-agent",
			title: "Launch Profile Session",
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

		const result = await manager.setAutonomousEnabled(sessionId, true, createMockEventHandler());

		expect(result.isErr()).toBe(true);
		expect(setSessionAutonomous).not.toHaveBeenCalled();
		expect(hotState.updateHotState).not.toHaveBeenCalled();
	});

	it("rolls Autonomous state back when backend policy sync fails", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "opencode",
			title: "Autonomous",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		setSessionAutonomous.mockReturnValue(
			errAsync(new AgentError("setSessionAutonomous", new Error("backend failed")))
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
			autonomousTransition: "idle",
		});
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});

	it("sets mode without an autonomous execution-profile retry", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Claude Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.readCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [{ id: "plan", name: "Plan", description: null }],
			availableModels: [],
			availableCommands: [],
			modelsDisplay: undefined,
		});
		setMode.mockReturnValue(errAsync(new AgentError("setMode", new Error("backend failed"))));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setMode(sessionId, "plan");
		expect(result.isErr()).toBe(true);

		expect(setMode).toHaveBeenCalledTimes(1);
		expect(setMode).toHaveBeenCalledWith(sessionId, "plan");
		expect(hotState.updateHotState).not.toHaveBeenCalled();
	});

	it("disables backend Autonomous when switching from build into plan mode", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Claude Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.readCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [{ id: "plan", name: "Plan", description: null }],
			availableModels: [],
			availableCommands: [],
			modelsDisplay: undefined,
		});
		setMode.mockReturnValue(okAsync(undefined));
		(stateReader.getSessionAutonomousEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
		(stateReader.getSessionCurrentModeId as ReturnType<typeof vi.fn>).mockReturnValue("build");

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setMode(sessionId, "plan");
		expect(result.isOk()).toBe(true);

		expect(setMode).toHaveBeenCalledWith(sessionId, "plan");
		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, false);
		expect(hotState.updateHotState).not.toHaveBeenCalled();
	});

	it("does not mutate hot state directly when setting model", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Claude Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.readCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [{ id: "build", name: "Build", description: null }],
			availableModels: [{ id: "gpt-5", name: "GPT-5", description: null }],
			availableCommands: [],
			modelsDisplay: undefined,
		});
		setModel.mockReturnValue(okAsync(undefined));

		const manager = createManager({
			stateReader,
			stateWriter,
			hotState,
			capabilities,
			entryManager,
			connectionManager,
		});

		const result = await manager.setModel(sessionId, "gpt-5");
		expect(result.isOk()).toBe(true);
		expect(setModel).toHaveBeenCalledWith(sessionId, "gpt-5");
		expect(hotState.updateHotState).not.toHaveBeenCalled();
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
		getSessionLifecycleStatus: vi.fn(),
		getEntries: vi.fn(),
		isPreloaded: vi.fn(),
		getSessionsForProject: vi.fn(),
		getSessionCold: vi.fn(),
		getAllSessions: vi.fn(),
	};

	const stateWriter: ISessionStateWriter = {
		addSession: vi.fn(),
		updateSession: vi.fn(),
		replaceSessionOpenSnapshot: vi.fn(),
		removeSession: vi.fn(),
		setSessions: vi.fn(),
		setLoading: vi.fn(),
		addScanningProjects: vi.fn(),
		removeScanningProjects: vi.fn(),
	};

	const hotState: ITransientProjectionManager = {
		getHotState: vi.fn(),
		hasHotState: vi.fn(),
		updateHotState: vi.fn(),
		removeHotState: vi.fn(),
		initializeHotState: vi.fn(),
	};

	const capabilities: TestCanonicalCapabilities = {
		readCapabilities: vi.fn(),
		hasCanonicalCapabilities: vi.fn(),
		recordCapabilityUpdate: vi.fn(),
		removeCanonicalCapabilities: vi.fn(),
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
		startNewAssistantTurn: vi.fn(),
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
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue(
			createResidualHotState({ acpSessionId: sessionId })
		);
		(stateReader.getSessionLifecycleStatus as ReturnType<typeof vi.fn>).mockReturnValue("activating");
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
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
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
	it("clears only local hot state when disconnecting a session", async () => {
		const sessionId = "session-disconnect";
		const stateReader: ISessionStateReader = {
			getHotState: vi.fn(
				(): SessionTransientProjection => ({
					acpSessionId: "acp-1",
					autonomousTransition: "idle",
					modelPerMode: {},
					statusChangedAt: Date.now(),
				})
			),
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
			replaceSessionOpenSnapshot: vi.fn(),
			removeSession: vi.fn(),
			setSessions: vi.fn(),
			setLoading: vi.fn(),
			addScanningProjects: vi.fn(),
			removeScanningProjects: vi.fn(),
		};

		const hotState: ITransientProjectionManager = {
			getHotState: vi.fn(),
			hasHotState: vi.fn(),
			updateHotState: vi.fn(),
			removeHotState: vi.fn(),
			initializeHotState: vi.fn(),
		};

		const capabilities: TestCanonicalCapabilities = {
			readCapabilities: vi.fn(),
			hasCanonicalCapabilities: vi.fn(),
			recordCapabilityUpdate: vi.fn(),
			removeCanonicalCapabilities: vi.fn(),
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
			startNewAssistantTurn: vi.fn(),
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
				acpSessionId: null,
				modelPerMode: {},
			})
		);
		expectNoCanonicalOverlapHotStateWrites(hotState.updateHotState as ReturnType<typeof vi.fn>);
	});
});
