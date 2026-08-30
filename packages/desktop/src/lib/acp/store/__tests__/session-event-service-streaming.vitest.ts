/**
 * Session Event Service Streaming Tests
 *
 * Covers the canonical session-state envelope pipeline:
 * - handleSessionStateEnvelope routing, buffering, and frontier ordering
 * - connection materialization waiters (waitForConnectionMaterialization)
 * - flushPendingEvents replay ordering
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		isLevelEnabled: vi.fn().mockReturnValue(false),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import type {
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateEnvelope,
	SessionStateGraph,
	TranscriptDelta,
} from "../../../services/acp-types.js";
import { getSessionStateEnvelopeByteBudget } from "../../session-state/session-state-envelope-budget.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import { SessionEventService } from "../session-event-service.svelte.js";
import type { SessionCold } from "../types.js";

function createMockHandler(): SessionEventHandler {
	return {
		getSessionCold: vi.fn().mockReturnValue({ id: "session-123" } as unknown as SessionCold),
		getSessionIdentity: vi.fn().mockReturnValue({
			id: "session-123",
			projectPath: "/tmp/project",
			agentId: "claude-code",
		}),
		getSessionCanSend: vi.fn().mockReturnValue(null),
		updateUsageTelemetry: vi.fn(),
		applySessionStateEnvelope: vi.fn(),
	};
}

function createGraphLifecycle(
	status: SessionGraphLifecycle["status"] = "reserved",
	errorMessage: string | null = null
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "reconnectExhausted" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached",
			canRetry: status === "failed",
			canArchive: status !== "archived",
			canConfigure: status === "ready",
			recommendedAction:
				status === "ready"
					? "send"
					: status === "detached"
						? "resume"
						: status === "failed"
							? "retry"
							: status === "archived"
								? "none"
								: "wait",
			recoveryPhase:
				status === "activating"
					? "activating"
					: status === "reconnecting"
						? "reconnecting"
						: status === "detached"
							? "detached"
							: status === "failed"
								? "failed"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

/**
 * A snapshot envelope, the one envelope kind that carries capabilities to the
 * store. Connection materialization reads them off the graph it holds.
 */
function createSnapshotEnvelope(input: {
	readonly sessionId: string;
	readonly graphRevision: number;
	readonly capabilities: SessionGraphCapabilities;
	readonly lifecycle?: SessionGraphLifecycle;
}): SessionStateEnvelope {
	const graph: SessionStateGraph = {
		requestedSessionId: input.sessionId,
		canonicalSessionId: input.sessionId,
		isAlias: false,
		agentId: "claude-code" as SessionStateGraph["agentId"],
		projectPath: "/tmp/project",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: input.graphRevision,
			transcriptRevision: 3,
			lastEventSeq: input.graphRevision,
		},
		transcriptSnapshot: {
			revision: 3,
			entries: [],
		},
		operations: [],
		interactions: [],
		turnState: "Idle",
		messageCount: 0,
		activeStreamingTail: null,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: input.lifecycle ?? createGraphLifecycle("activating"),
		activity: createIdleActivity(),
		capabilities: input.capabilities,
	};
	return {
		sessionId: input.sessionId,
		graphRevision: input.graphRevision,
		lastEventSeq: input.graphRevision,
		payload: {
			kind: "snapshot",
			graph,
		},
	};
}

describe("SessionEventService streaming delta handling", () => {
	let service: SessionEventService;
	let handler: SessionEventHandler;

	beforeEach(() => {
		service = new SessionEventService();
		handler = createMockHandler();
	});

	it("routes session-state delta envelopes through the canonical transcript path", () => {
		const delta: TranscriptDelta = {
			eventSeq: 7,
			sessionId: "session-123",
			snapshotRevision: 7,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:7",
								text: "hello",
							},
						],
					},
				},
			],
		};
		const envelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 6, transcriptRevision: 6, lastEventSeq: 6 },
					toRevision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: delta.operations,
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, handler);

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledWith("session-123", envelope);
	});

	it("buffers canonical session-state envelopes until the session is registered", async () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const envelope: SessionStateEnvelope = {
			sessionId: "session-pending-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 7,
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, pendingHandler);

		expect(pendingHandler.applySessionStateEnvelope).not.toHaveBeenCalled();

		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-1",
		} as unknown as SessionCold);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-1",
			projectPath: "/tmp/project",
			agentId: "claude-code",
		});
		service.flushPendingEvents("session-pending-1", pendingHandler);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-1",
			envelope
		);
	});

	it("prunes stale buffered session-state envelopes before replay", async () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const staleEnvelope: SessionStateEnvelope = {
			sessionId: "session-pending-ordered-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 7,
				},
			},
		};
		const freshEnvelope: SessionStateEnvelope = {
			sessionId: "session-pending-ordered-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 8,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
			},
		};

		service.handleSessionStateEnvelope(staleEnvelope, pendingHandler);
		service.handleSessionStateEnvelope(freshEnvelope, pendingHandler);

		expect(pendingHandler.applySessionStateEnvelope).not.toHaveBeenCalled();

		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-ordered-1",
		} as unknown as SessionCold);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-ordered-1",
			projectPath: "/tmp/project",
			agentId: "claude-code",
		});
		service.flushPendingEvents("session-pending-ordered-1", pendingHandler);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-ordered-1",
			freshEnvelope
		);
	});

	it("drops same-graph envelopes with older event sequence at ingress", () => {
		const freshEnvelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 7,
			lastEventSeq: 10,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 10,
				},
			},
		};
		const staleEnvelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
			},
		};

		service.handleSessionStateEnvelope(freshEnvelope, handler);
		service.handleSessionStateEnvelope(staleEnvelope, handler);

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(handler.applySessionStateEnvelope).toHaveBeenCalledWith("session-123", freshEnvelope);
	});

	it("prunes buffered same-graph envelopes with older event sequence before replay", async () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const staleEnvelope: SessionStateEnvelope = {
			sessionId: "session-pending-ordered-2",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("reconnecting"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 7,
				},
			},
		};
		const freshEnvelope: SessionStateEnvelope = {
			sessionId: "session-pending-ordered-2",
			graphRevision: 7,
			lastEventSeq: 8,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
			},
		};

		service.handleSessionStateEnvelope(staleEnvelope, pendingHandler);
		service.handleSessionStateEnvelope(freshEnvelope, pendingHandler);

		expect(pendingHandler.applySessionStateEnvelope).not.toHaveBeenCalled();

		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-ordered-2",
		} as unknown as SessionCold);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-ordered-2",
			projectPath: "/tmp/project",
			agentId: "claude-code",
		});
		service.flushPendingEvents("session-pending-ordered-2", pendingHandler);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-ordered-2",
			freshEnvelope
		);
	});

	it("materializes pending creation sessions before applying canonical delta envelopes", () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(pendingHandler.getSessionIdentity as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		pendingHandler.materializePendingCreationSession = vi.fn().mockReturnValue(true);
		const envelope: SessionStateEnvelope = {
			sessionId: "session-pending-creation-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 6, transcriptRevision: 6, lastEventSeq: 6 },
					toRevision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["turnState"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, pendingHandler);

		expect(pendingHandler.materializePendingCreationSession).toHaveBeenCalledWith(
			"session-pending-creation-1"
		);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-creation-1",
			envelope
		);
	});

	it("[regression] does not buffer transcript deltas while connecting", () => {
		const reconnectingHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(reconnectingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const delta: TranscriptDelta = {
			sessionId: "session-123",
			eventSeq: 42,
			snapshotRevision: 42,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-42",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-42:segment:42",
								text: "post-snapshot delta",
							},
						],
					},
				},
			],
		};

		const envelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 42,
			lastEventSeq: 42,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 41, transcriptRevision: 41, lastEventSeq: 41 },
					toRevision: { graphRevision: 42, transcriptRevision: 42, lastEventSeq: 42 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: delta.operations,
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, reconnectingHandler);

		expect(reconnectingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(reconnectingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				sessionId: "session-123",
				graphRevision: 42,
				lastEventSeq: 42,
			})
		);
	});

	it("rejects canonical connection waiters from lifecycle error envelopes", async () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-crash-1", agentId: "copilot" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);
		const { promise } = service.waitForConnectionMaterialization("session-crash-1", 5000);

		service.handleSessionStateEnvelope(
			{
				sessionId: "session-crash-1",
				graphRevision: 4,
				lastEventSeq: 4,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("failed", "Provider disconnected"),
					revision: {
						graphRevision: 4,
						transcriptRevision: 2,
						lastEventSeq: 4,
					},
				},
			},
			disconnectedHandler
		);

		await expect(promise).rejects.toThrow("Provider disconnected");
	});

	it("resolves canonical connection waiters once ready lifecycle and capabilities arrive", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization("session-ready-1", 5000);

		service.handleSessionStateEnvelope(
			createSnapshotEnvelope({
				sessionId: "session-ready-1",
				graphRevision: 8,
				capabilities: {
					models: {
						availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
						currentModelId: "claude-sonnet-4.6",
					},
					modes: {
						currentModeId: "build",
						availableModes: [{ id: "build", name: "Build", description: null }],
					},
					availableCommands: [{ name: "compact", description: "Compact", input: null }],
					configOptions: [],
					autonomousEnabled: true,
				},
			}),
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-1",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			autonomousEnabled: true,
			availableCommands: [{ name: "compact", description: "Compact", input: null }],
			modes: {
				currentModeId: "build",
			},
		});
	});

	it("rejects oversized session-state envelopes before advancing connection revision frontiers", async () => {
		const connectedHandler = createMockHandler();
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-budget-1",
				graphRevision: 99,
				lastEventSeq: 99,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle(
						"ready",
						"x".repeat(getSessionStateEnvelopeByteBudget("lifecycle"))
					),
					revision: {
						graphRevision: 99,
						transcriptRevision: 99,
						lastEventSeq: 99,
					},
				},
			},
			connectedHandler
		);
		const { promise } = service.waitForConnectionMaterialization("session-ready-budget-1", 5000);

		service.handleSessionStateEnvelope(
			createSnapshotEnvelope({
				sessionId: "session-ready-budget-1",
				graphRevision: 1,
				capabilities: {
					models: {
						availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
						currentModelId: "claude-sonnet-4.6",
					},
					modes: {
						currentModeId: "build",
						availableModes: [{ id: "build", name: "Build", description: null }],
					},
					availableCommands: [],
					configOptions: [],
					autonomousEnabled: true,
				},
			}),
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-budget-1",
				graphRevision: 1,
				lastEventSeq: 1,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 1,
						transcriptRevision: 1,
						lastEventSeq: 1,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			autonomousEnabled: true,
			modes: {
				currentModeId: "build",
			},
		});
		expect(connectedHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(2);
	});

	it("drops lower-revision session-state envelopes after a newer frontier", () => {
		const handler = createMockHandler();
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ordered-1",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			handler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ordered-1",
				graphRevision: 7,
				lastEventSeq: 7,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("reconnecting"),
					revision: {
						graphRevision: 7,
						transcriptRevision: 3,
						lastEventSeq: 7,
					},
				},
			},
			handler
		);

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(handler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-ordered-1",
			expect.objectContaining({ graphRevision: 8 })
		);
	});

	it("allows same-revision session-state envelopes in one frontier batch", () => {
		const handler = createMockHandler();
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ordered-2",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "sessionMode",
					currentModeId: "plan",
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			handler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ordered-2",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			handler
		);

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledTimes(2);
	});

	it("preserves missing autonomous capability in connection materialization", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization(
			"session-ready-unknown-autonomous",
			5000
		);

		service.handleSessionStateEnvelope(
			createSnapshotEnvelope({
				sessionId: "session-ready-unknown-autonomous",
				graphRevision: 8,
				capabilities: {
					models: {
						availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
						currentModelId: "claude-sonnet-4.6",
					},
					modes: {
						currentModeId: "build",
						availableModes: [{ id: "build", name: "Build", description: null }],
					},
					availableCommands: [],
					configOptions: [],
				},
			}),
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-autonomous",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			autonomousEnabled: null,
		});
	});

	it("preserves missing command and config capability lists in connection materialization", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization(
			"session-ready-unknown-lists",
			5000
		);

		service.handleSessionStateEnvelope(
			createSnapshotEnvelope({
				sessionId: "session-ready-unknown-lists",
				graphRevision: 8,
				capabilities: {
					models: {
						availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
						currentModelId: "claude-sonnet-4.6",
					},
					modes: {
						currentModeId: "build",
						availableModes: [{ id: "build", name: "Build", description: null }],
					},
					autonomousEnabled: true,
				},
			}),
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-lists",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			availableCommands: null,
			configOptions: null,
		});
	});
});
