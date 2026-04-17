import { errAsync, okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModelState } from "../../../services/acp-types.js";
import type {
	AvailableCommand,
	ConfigOptionData,
} from "../../../services/converted-session-types.js";
import { AgentError } from "../../errors/app-error.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import type { ConnectionCompleteData } from "../session-event-service.svelte.js";
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
const setSessionAutonomous = vi.fn();
const setModel = vi.fn();
const stopStreaming = vi.fn();

vi.mock("../api.js", () => ({
	api: {
		closeSession,
		newSession,
		resumeSession,
		setMode,
		setSessionAutonomous,
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
		applyTranscriptDelta: vi.fn(),
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
	hotState: IHotStateManager;
	capabilities: ICapabilitiesManager;
	entryManager: IEntryManager;
	connectionManager: IConnectionManager;
}) {
	lastEventService = new SessionEventService();
	vi.spyOn(lastEventService, "waitForLifecycleEvent").mockImplementation(() => ({
		promise: Promise.resolve(nextLifecycleResult),
		cancel: vi.fn(),
	}));
	return new SessionConnectionManager(
		deps.stateReader,
		deps.stateWriter,
		deps.hotState,
		deps.capabilities,
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
	modes: { currentModeId: string; availableModes: Array<{ id: string; name: string; description: string | null }> };
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
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(baseSession);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
		});
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

		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				autonomousEnabled: true,
				isConnected: true,
				status: "ready",
			})
		);
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
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentMode: { id: "build", name: "Build", description: null },
		});
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
		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				autonomousEnabled: true,
			})
		);
	});

	it("passes the hydrated launch mode when reconnecting a Copilot session", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			...baseSession,
			agentId: "copilot",
		} satisfies SessionCold);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: false,
			autonomousTransition: "idle",
			currentMode: { id: "plan", name: "Plan", description: null },
		});
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
			"plan",
			undefined
		);
	});

	it("clears Autonomous when reconnecting into a mode that does not support it", async () => {
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentMode: { id: "build", name: "Build", description: null },
		});
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

		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				autonomousEnabled: false,
				currentMode: { id: "plan", name: "Plan", description: undefined },
			})
		);
	});

	it("ignores cached provider metadata when restoring autonomous policy on reconnect", async () => {
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			...baseSession,
			agentId: "custom-agent",
		} satisfies SessionCold);
		(stateReader.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			isStreaming: false,
			status: "idle",
			autonomousEnabled: true,
			autonomousTransition: "idle",
			currentMode: { id: "build", name: "Build", description: null },
		});
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
		expect(hotState.updateHotState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				autonomousEnabled: true,
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

		const lastUpdate = (hotState.updateHotState as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
		expect(lastUpdate?.currentModel?.id).toBe("model-b");
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

		const capabilitiesUpdate = (
			capabilities.updateCapabilities as ReturnType<typeof vi.fn>
		).mock.calls.at(-1)?.[1];
		expect(capabilitiesUpdate?.modelsDisplay?.presentation?.provider?.providerBrand).toBe("codex");
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

	it("flushes pending events after lifecycle-driven connect completes", async () => {
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
		// After the cold/hot split, currentModel is in hot state, not cold.
		// Verify cold data was stored correctly.
		expect(addedSession.id).toBe(sessionId);
		expect(addedSession.agentId).toBe(agentId);
		// Verify hot state was initialized with the resolved model
		const hotStateInit = (hotState.initializeHotState as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1];
		expect(hotStateInit?.currentModel?.id).toBe("vendor/codex-enterprise/high");
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
		expect(hotStateInit?.currentModel?.id).toBe("vendor/codex-enterprise/high");
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
		expect(initUpdate?.currentMode?.id).toBe("plan");
		expect(initUpdate?.currentModel?.id).toBe("gpt-5.2-codex/medium");
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
		expect(initUpdate?.currentMode?.id).toBe("plan");
		expect(initUpdate?.currentModel?.id).toBe("gpt-5.2-codex/medium");
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
		expect(initUpdate?.currentMode?.id).toBe("build");
		expect(initUpdate?.currentModel?.id).toBe("gpt-5.2-codex/high");
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
		const session = result._unsafeUnwrap();

		expect(stateWriter.addSession).toHaveBeenCalled();
		expect(session).toEqual(
			expect.objectContaining({
				id: sessionId,
				projectPath,
				agentId,
			})
		);
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
		expect(initUpdate?.autonomousEnabled).toBe(true);
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
		setSessionAutonomous.mockReturnValue(okAsync(undefined));
	});

	it("syncs Autonomous after updating local transition state", async () => {
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
			autonomousEnabled: true,
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

		expect(setSessionAutonomous).toHaveBeenCalledWith(sessionId, true);
		expect(hotState.updateHotState).toHaveBeenCalledWith(sessionId, {
			autonomousEnabled: true,
			autonomousTransition: "idle",
		});
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
			autonomousEnabled: true,
			autonomousTransition: "enabling",
		});
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(2, sessionId, {
			autonomousEnabled: false,
			autonomousTransition: "idle",
		});
	});

	it("does not reconnect sessions to enable Autonomous", async () => {
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
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "custom-agent",
			title: "Launch Profile Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.getCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
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
			autonomousEnabled: true,
			autonomousTransition: "enabling",
		});
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(2, sessionId, {
			autonomousEnabled: false,
			autonomousTransition: "idle",
		});
	});

	it("sets mode without an autonomous execution-profile retry", async () => {
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
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Claude Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.getCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [{ id: "plan", name: "Plan", description: null }],
			availableModels: [],
			availableCommands: [],
			modelsDisplay: undefined,
		});
		setMode.mockReturnValue(
			errAsync(new AgentError("setMode", new Error("backend failed")))
		);

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
		expect(hotState.updateHotState).toHaveBeenCalledWith(sessionId, {
			currentMode: { id: "build", name: "Build", description: null },
			autonomousEnabled: true,
		});
	});

	it("disables backend Autonomous when switching from build into plan mode", async () => {
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
		(stateReader.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: sessionId,
			projectPath: "/tmp/project",
			agentId: "claude-code",
			title: "Claude Session",
			updatedAt: new Date(),
			createdAt: new Date(),
			parentId: null,
		} satisfies SessionCold);
		(capabilities.getCapabilities as ReturnType<typeof vi.fn>).mockReturnValue({
			availableModes: [{ id: "plan", name: "Plan", description: null }],
			availableModels: [],
			availableCommands: [],
			modelsDisplay: undefined,
		});
		setMode.mockReturnValue(okAsync(undefined));

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
		expect(hotState.updateHotState).toHaveBeenNthCalledWith(1, sessionId, {
			currentMode: { id: "plan", name: "Plan", description: null },
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
			getHotState: vi.fn(
				(): SessionHotState => ({
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
