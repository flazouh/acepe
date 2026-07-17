import { describe, expect, it } from "vitest";

import type {
	CapabilityPreviewState,
	PlanData,
	SessionGraphCapabilities,
	SessionGraphRevision,
	SessionStateGraph,
	UsageTelemetryData,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../../../services/acp-types.js";
import type { SessionStateCommand } from "../../../session-state/session-state-command-router.js";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import type { SessionTransientProjection } from "../../types.js";
import { DEFAULT_TRANSIENT_PROJECTION } from "../../types.js";
import type { EnvelopeReducerSnapshot } from "../envelope-snapshot.js";
import { buildCanonicalUsageTelemetry } from "../canonical-usage-telemetry.js";
import { reduceCommand } from "../reduce-command.js";

const revision: SessionGraphRevision = {
	graphRevision: 10,
	transcriptRevision: 7,
	lastEventSeq: 10,
};

const newerRevision: SessionGraphRevision = {
	graphRevision: 11,
	transcriptRevision: 7,
	lastEventSeq: 11,
};

function createProjection(
	overrides: Partial<CanonicalSessionProjection> = {}
): CanonicalSessionProjection {
	return {
		lifecycle: overrides.lifecycle ?? {
			status: "ready",
			detachedReason: null,
			failureReason: null,
			errorMessage: null,
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: true,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		activity: overrides.activity ?? {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
		turnState: overrides.turnState ?? "Idle",
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		activeStreamingTail: overrides.activeStreamingTail ?? null,
		capabilities: overrides.capabilities ?? {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: null,
		},
		revision: overrides.revision ?? revision,
	};
}

function createGraph(overrides: Partial<SessionStateGraph> = {}): SessionStateGraph {
	return {
		requestedSessionId: overrides.requestedSessionId ?? "session-1",
		canonicalSessionId: overrides.canonicalSessionId ?? "session-1",
		isAlias: overrides.isAlias ?? false,
		agentId: overrides.agentId ?? "codex",
		projectPath: overrides.projectPath ?? "/repo",
		worktreePath: overrides.worktreePath ?? null,
		sourcePath: overrides.sourcePath ?? null,
		revision: overrides.revision ?? revision,
		transcriptSnapshot: overrides.transcriptSnapshot ?? {
			revision: 7,
			entries: [],
		},
		operations: overrides.operations ?? [],
		interactions: overrides.interactions ?? [],
		turnState: overrides.turnState ?? "Idle",
		messageCount: overrides.messageCount ?? 0,
		activeStreamingTail: overrides.activeStreamingTail ?? null,
		activeTurnFailure: overrides.activeTurnFailure ?? null,
		lastTerminalTurnId: overrides.lastTerminalTurnId ?? null,
		lifecycle: overrides.lifecycle ?? createProjection().lifecycle,
		activity: overrides.activity ?? createProjection().activity,
		capabilities: overrides.capabilities ?? createProjection().capabilities,
	};
}

function createSnapshot(
	overrides: Partial<EnvelopeReducerSnapshot> = {}
): EnvelopeReducerSnapshot {
	return {
		sessionId: overrides.sessionId ?? "session-1",
		hasSessionIdentity: overrides.hasSessionIdentity ?? true,
		previousProjection:
			overrides.previousProjection !== undefined
				? overrides.previousProjection
				: createProjection(),
		previousGraph:
			overrides.previousGraph !== undefined ? overrides.previousGraph : createGraph(),
		capabilitiesMaterialized: overrides.capabilitiesMaterialized ?? false,
		transientProjection: overrides.transientProjection ?? DEFAULT_TRANSIENT_PROJECTION,
		currentModelId: overrides.currentModelId ?? null,
		sessionCold: overrides.sessionCold,
	};
}

function createCapabilitiesCommand(
	capabilities: SessionGraphCapabilities,
	commandRevision: SessionGraphRevision = revision,
	pendingMutationId: string | null = "mutation-1",
	previewState: CapabilityPreviewState = "canonical"
): Extract<SessionStateCommand, { kind: "applyCapabilities" }> {
	return {
		kind: "applyCapabilities",
		capabilities,
		revision: commandRevision,
		pendingMutationId,
		previewState,
	};
}

describe("reduceCommand", () => {
	it("returns no patches when capabilities arrive without session identity", () => {
		const patches = reduceCommand(
			createSnapshot({ hasSessionIdentity: false }),
			createCapabilitiesCommand({
				models: null,
				modes: null,
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: true,
			}),
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("returns no patches for stale capabilities revisions", () => {
		const patches = reduceCommand(
			createSnapshot({
				previousProjection: createProjection({
					revision: {
						graphRevision: 11,
						transcriptRevision: 7,
						lastEventSeq: 11,
					},
				}),
			}),
			createCapabilitiesCommand(
				{
					models: null,
					modes: null,
					availableCommands: [],
					configOptions: [],
					autonomousEnabled: true,
				},
				revision
			),
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("emits canonical, graph, and transient patches for newer capabilities", () => {
		const previousProjection = createProjection();
		const previousGraph = createGraph();
		const capabilities: SessionGraphCapabilities = {
			models: { availableModels: [{ modelId: "gpt-5", name: "GPT-5" }] },
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: true,
		};

		const patches = reduceCommand(
			createSnapshot({
				previousProjection,
				previousGraph,
				transientProjection: {
					acpSessionId: "session-1",
					pendingSendIntent: null,
					autonomousTransition: "enabling",
					statusChangedAt: 1,
				},
			}),
			createCapabilitiesCommand(capabilities, newerRevision),
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "setCapabilitiesMaterialized",
				sessionId: "session-1",
				materialized: true,
			},
			{
				kind: "setCanonicalProjection",
				sessionId: "session-1",
				projection: {
					lifecycle: previousProjection.lifecycle,
					activity: previousProjection.activity,
					turnState: previousProjection.turnState,
					activeTurnFailure: previousProjection.activeTurnFailure,
					lastTerminalTurnId: previousProjection.lastTerminalTurnId,
					activeStreamingTail: previousProjection.activeStreamingTail,
					capabilities,
					revision: newerRevision,
				},
			},
			{
				kind: "setSessionStateGraph",
				sessionId: "session-1",
				graph: {
					requestedSessionId: previousGraph.requestedSessionId,
					canonicalSessionId: previousGraph.canonicalSessionId,
					isAlias: previousGraph.isAlias,
					agentId: previousGraph.agentId,
					projectPath: previousGraph.projectPath,
					worktreePath: previousGraph.worktreePath,
					sourcePath: previousGraph.sourcePath,
					sequenceId: previousGraph.sequenceId,
					revision: newerRevision,
					transcriptSnapshot: previousGraph.transcriptSnapshot,
					operations: previousGraph.operations,
					interactions: previousGraph.interactions,
					turnState: previousGraph.turnState,
					messageCount: previousGraph.messageCount,
					activeStreamingTail: previousGraph.activeStreamingTail,
					activeTurnFailure: previousGraph.activeTurnFailure,
					lastTerminalTurnId: previousGraph.lastTerminalTurnId,
					lifecycle: previousGraph.lifecycle,
					activity: previousGraph.activity,
					capabilities,
				},
			},
			{
				kind: "updateTransientProjection",
				sessionId: "session-1",
				updates: {
					capabilityMutationState: {
						pendingMutationId: "mutation-1",
						previewState: "canonical",
					},
					autonomousTransition: "idle",
				},
			},
		]);
	});

	it("returns no telemetry patches for stale revisions", () => {
		const patches = reduceCommand(
			createSnapshot({
				previousProjection: createProjection({
					revision: {
						graphRevision: 11,
						transcriptRevision: 7,
						lastEventSeq: 11,
					},
				}),
			}),
			{
				kind: "applyTelemetry",
				revision,
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-1",
					scope: "turn",
					costUsd: 0.5,
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("emits usage telemetry patches for newer telemetry", () => {
		const patches = reduceCommand(
			createSnapshot(),
			{
				kind: "applyTelemetry",
				revision: newerRevision,
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-1",
					scope: "turn",
					contextWindowSize: 200000,
					tokens: {
						total: 50000,
						input: 30000,
						output: 20000,
					},
					costUsd: 0.42,
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "setUsageTelemetry",
				sessionId: "session-1",
				telemetry: {
					sessionSpendUsd: 0.42,
					latestStepCostUsd: 0.42,
					latestTokensTotal: 50000,
					latestTokensInput: 30000,
					latestTokensOutput: 20000,
					latestTokensCacheRead: null,
					latestTokensCacheWrite: null,
					latestTokensReasoning: null,
					lastTelemetryEventId: "telemetry-1",
					contextBudget: {
						maxTokens: 200000,
						source: "provider-explicit",
						scope: "turn",
						updatedAt: 1_700_000_000_000,
					},
					updatedAt: 1_700_000_000_000,
				},
			},
		]);
	});

	it("returns no plan patches for stale revisions", () => {
		const plan: PlanData = {
			steps: [],
			content: "# Plan",
		};
		const patches = reduceCommand(
			createSnapshot({
				previousProjection: createProjection({
					revision: {
						graphRevision: 11,
						transcriptRevision: 7,
						lastEventSeq: 11,
					},
				}),
			}),
			{
				kind: "applyPlan",
				revision,
				plan,
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("emits plan notification patches for newer plans", () => {
		const plan: PlanData = {
			steps: [],
			content: "# Plan",
		};

		const patches = reduceCommand(
			createSnapshot(),
			{
				kind: "applyPlan",
				revision: newerRevision,
				plan,
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "notifyPlanUpdate",
				sessionId: "session-1",
				plan,
			},
		]);
	});

	it("forwards viewport buffer push commands as patches", () => {
		const push: ViewportBufferPush = {
			sessionId: "session-1",
			graphRevision: revision,
			emissionSeq: 0,
			rows: [],
			diagnostics: [],
		};

		const patches = reduceCommand(
			createSnapshot(),
			{ kind: "applyBufferPush", push },
			1_700_000_000_000
		);

		expect(patches).toEqual([{ kind: "applyViewportBufferPush", push }]);
	});

	it("forwards viewport buffer delta commands as patches", () => {
		const delta: ViewportBufferDelta = {
			sessionId: "session-1",
			graphRevision: revision,
			emissionSeq: 1,
			prependedRows: [],
			appendedRows: [],
			removedRowIds: [],
			diagnostics: [],
		};

		const patches = reduceCommand(
			createSnapshot(),
			{ kind: "applyBufferDelta", delta },
			1_700_000_000_000
		);

		expect(patches).toEqual([{ kind: "applyViewportBufferDelta", delta }]);
	});

	it("deduplicates telemetry events by event id", () => {
		const patches = reduceCommand(
			createSnapshot({
				transientProjection: {
					acpSessionId: "session-1",
					pendingSendIntent: null,
					autonomousTransition: "idle",
					statusChangedAt: 1,
					usageTelemetry: {
						sessionSpendUsd: 0.42,
						latestStepCostUsd: 0.42,
						latestTokensTotal: 50000,
						latestTokensInput: 30000,
						latestTokensOutput: 20000,
						latestTokensCacheRead: null,
						latestTokensCacheWrite: null,
						latestTokensReasoning: null,
						lastTelemetryEventId: "telemetry-1",
						contextBudget: null,
						updatedAt: 1,
					},
				},
			}),
			{
				kind: "applyTelemetry",
				revision,
				telemetry: {
					sessionId: "session-1",
					eventId: "telemetry-1",
					scope: "turn",
					costUsd: 0.99,
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("preserves authoritative context occupancy when a cost-only result event arrives", () => {
		// Regression: Claude Code's Result message is the only cost-bearing telemetry
		// event, and it carries cumulative-per-turn tokens (cache reads summed across
		// every API round-trip) — a value that overshoots the physical context window.
		// It must NOT clobber the authoritative occupancy snapshot established by an
		// earlier usage_update / assistant message. A cost-only event (no token total)
		// updates cost while leaving the occupancy untouched.
		const patches = reduceCommand(
			createSnapshot({
				transientProjection: {
					acpSessionId: "session-1",
					pendingSendIntent: null,
					autonomousTransition: "idle",
					statusChangedAt: 1,
					usageTelemetry: {
						sessionSpendUsd: 0,
						latestStepCostUsd: null,
						latestTokensTotal: 184_000,
						latestTokensInput: 1_200,
						latestTokensOutput: null,
						latestTokensCacheRead: 182_000,
						latestTokensCacheWrite: 800,
						latestTokensReasoning: null,
						lastTelemetryEventId: "usage-update-1",
						contextBudget: {
							maxTokens: 1_000_000,
							source: "provider-explicit",
							scope: "turn",
							updatedAt: 1,
						},
						updatedAt: 1,
					},
				},
			}),
			{
				kind: "applyTelemetry",
				revision: newerRevision,
				telemetry: {
					sessionId: "session-1",
					eventId: null,
					scope: "step",
					costUsd: 2.0568,
					sourceModelId: "claude-opus-4-8",
					contextWindowSize: 1_000_000,
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "setUsageTelemetry",
				sessionId: "session-1",
				telemetry: {
					sessionSpendUsd: 2.0568,
					latestStepCostUsd: 2.0568,
					// occupancy preserved, NOT replaced by a cumulative result total
					latestTokensTotal: 184_000,
					latestTokensInput: 1_200,
					latestTokensOutput: null,
					latestTokensCacheRead: 182_000,
					latestTokensCacheWrite: 800,
					latestTokensReasoning: null,
					lastTelemetryEventId: null,
					contextBudget: {
						maxTokens: 1_000_000,
						source: "provider-explicit",
						scope: "step",
						updatedAt: 1_700_000_000_000,
					},
					updatedAt: 1_700_000_000_000,
				},
			},
		]);
	});

	it("preserves provider model capability provenance", () => {
		const patches = reduceCommand(
			createSnapshot(),
			{
				kind: "applyTelemetry",
				revision: newerRevision,
				telemetry: {
					sessionId: "session-1",
					scope: "session",
					sourceModelId: "fable",
					contextWindowSize: 1_000_000,
					contextWindowSource: "provider-model-capability",
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "setUsageTelemetry",
				sessionId: "session-1",
				telemetry: expect.objectContaining({
					contextBudget: {
						maxTokens: 1_000_000,
						source: "provider-model-capability",
						scope: "session",
						updatedAt: 1_700_000_000_000,
					},
				}),
			},
		]);
	});

	it("excludes sub-agent telemetry from the session context widget", () => {
		const patches = reduceCommand(
			createSnapshot(),
			{
				kind: "applyTelemetry",
				revision: newerRevision,
				telemetry: {
					sessionId: "session-1",
					parentToolUseId: "toolu_parent",
					tokens: { total: 75_000 },
				},
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("keeps explicit budget authority across later occupancy", () => {
		const capability = buildCanonicalUsageTelemetry(
			{
				sessionId: "session-1",
				contextWindowSize: 1_000_000,
				contextWindowSource: "provider-model-capability",
			},
			undefined,
			"fable",
			1
		);
		const explicit = buildCanonicalUsageTelemetry(
			{
				sessionId: "session-1",
				contextWindowSize: 1_000_000,
				contextWindowSource: "provider-explicit",
			},
			capability !== null ? capability : undefined,
			"claude-fable-5",
			2
		);
		const occupancy = buildCanonicalUsageTelemetry(
			{
				sessionId: "session-1",
				tokens: { total: 189_218 },
			},
			explicit !== null ? explicit : undefined,
			"claude-fable-5",
			3
		);

		expect(occupancy?.contextBudget?.source).toBe("provider-explicit");
		expect(occupancy?.contextBudget?.maxTokens).toBe(1_000_000);
		expect(occupancy?.latestTokensTotal).toBe(189_218);
	});

	it("clears the previous budget for an unknown model capability", () => {
		const previous = buildCanonicalUsageTelemetry(
			{
				sessionId: "session-1",
				contextWindowSize: 1_000_000,
				contextWindowSource: "provider-explicit",
			},
			undefined,
			"claude-fable-5",
			1
		);
		const changed = buildCanonicalUsageTelemetry(
			{
				sessionId: "session-1",
				sourceModelId: "custom-model",
				contextWindowSource: "unknown",
			},
			previous !== null ? previous : undefined,
			"custom-model",
			2
		);

		expect(changed?.contextBudget).toBeNull();
	});

	it("emits refresh snapshot intent for transcript frontier mismatch", () => {
		const patches = reduceCommand(
			createSnapshot({
				previousGraph: createGraph({
					transcriptSnapshot: { revision: 5, entries: [] },
				}),
			}),
			{
				kind: "refreshSnapshot",
				fromRevision: 5,
				toRevision: 7,
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "refreshSessionStateSnapshot",
				sessionId: "session-1",
				reason: "transcriptFrontierMismatch",
				warnContext: {
					currentTranscriptRevision: 5,
					fromRevision: 5,
					toRevision: 7,
				},
			},
		]);
	});

	it("returns no patches for reject command kinds", () => {
		const patches = reduceCommand(
			createSnapshot(),
			{
				kind: "rejectSessionMismatch",
				expectedSessionId: "session-1",
				envelopeSessionId: "session-2",
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("emits lifecycle patches with connection and awaiting-refresh intents", () => {
		const previousProjection = createProjection();
		const previousGraph = createGraph();
		const lifecycle = {
			status: "ready" as const,
			detachedReason: null,
			failureReason: null,
			errorMessage: null,
			actionability: previousProjection.lifecycle.actionability,
		};

		const patches = reduceCommand(
			createSnapshot({ previousProjection, previousGraph }),
			{
				kind: "applyLifecycle",
				lifecycle,
				revision: newerRevision,
			},
			1_700_000_000_000
		);

		expect(patches.some((patch) => patch.kind === "setCanonicalProjection")).toBe(true);
		expect(patches.some((patch) => patch.kind === "reconcileConnectionMachine")).toBe(true);
		expect(patches.some((patch) => patch.kind === "syncAwaitingModelRefreshTimer")).toBe(true);
	});

	it("emits replace graph patches with creation coordinator consumer intent", () => {
		const previousGraph = createGraph();
		const incomingGraph = createGraph({
			revision: newerRevision,
			transcriptSnapshot: { revision: 8, entries: [] },
		});

		const patches = reduceCommand(
			createSnapshot({ previousGraph }),
			{ kind: "replaceGraph", graph: incomingGraph },
			1_700_000_000_000
		);

		expect(patches.some((patch) => patch.kind === "replaceSessionOperations")).toBe(true);
		expect(patches.some((patch) => patch.kind === "replaceLiveSessionStateGraph")).toBe(true);
		expect(patches.some((patch) => patch.kind === "applySessionStateGraph")).toBe(true);
	});

	it("emits graph patch side-effect intents for newer revisions", () => {
		const previousProjection = createProjection();
		const previousGraph = createGraph();

		const patches = reduceCommand(
			createSnapshot({ previousProjection, previousGraph }),
			{
				kind: "applyGraphPatches",
				revision: newerRevision,
				activity: undefined,
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
				activeStreamingTail: undefined,
				operationPatches: [],
				interactionPatches: [],
			},
			1_700_000_000_000
		);

		expect(patches.some((patch) => patch.kind === "invokeCanonicalTerminalTurnSideEffects")).toBe(
			true
		);
		expect(patches.some((patch) => patch.kind === "reconcileConnectionMachine")).toBe(true);
	});

	it("normalizes terminal turn graph patches to idle even when activity fields are omitted", () => {
		const staleActivity = {
			kind: "awaiting_model" as const,
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		};
		const staleTail = { rowId: "assistant-1", contentKind: "message" as const };
		const previousProjection = createProjection({
			activity: staleActivity,
			turnState: "Running",
			activeStreamingTail: staleTail,
		});
		const previousGraph = createGraph({
			activity: staleActivity,
			turnState: "Running",
			activeStreamingTail: staleTail,
		});

		const patches = reduceCommand(
			createSnapshot({ previousProjection, previousGraph }),
			{
				kind: "applyGraphPatches",
				revision: newerRevision,
				activity: undefined,
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
				activeStreamingTail: undefined,
				operationPatches: [],
				interactionPatches: [],
			},
			1_700_000_000_000
		);

		const graphPatch = patches.find((patch) => patch.kind === "setSessionStateGraph");
		const projectionPatch = patches.find((patch) => patch.kind === "setCanonicalProjection");

		expect(graphPatch).toMatchObject({
			graph: {
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				activeStreamingTail: null,
				turnState: "Completed",
			},
		});
		expect(projectionPatch).toMatchObject({
			projection: {
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				activeStreamingTail: null,
				turnState: "Completed",
			},
		});
	});

	it("refreshes snapshot when graph patches arrive before canonical projection", () => {
		const patches = reduceCommand(
			createSnapshot({ previousProjection: null }),
			{
				kind: "applyGraphPatches",
				revision: newerRevision,
				activity: undefined,
				turnState: undefined,
				activeTurnFailure: undefined,
				lastTerminalTurnId: undefined,
				activeStreamingTail: undefined,
				operationPatches: [],
				interactionPatches: [],
			},
			1_700_000_000_000
		);

		expect(patches).toEqual([
			{
				kind: "warnMissingCanonicalProjection",
				sessionId: "session-1",
				reason: "graphPatches",
				context: { revision: newerRevision },
			},
			{
				kind: "refreshSessionStateSnapshot",
				sessionId: "session-1",
				reason: "missingCanonicalProjection",
			},
		]);
	});

	it("keeps pending send intent until the viewport can replace its optimistic row", () => {
		const pendingSendIntent = {
			attemptId: "attempt-1",
			startedAt: 1,
			baselineTranscriptRevision: 6,
			promptLength: 5,
			optimisticEntry: {
				type: "user" as const,
				id: "optimistic-1",
				timestamp: new Date(1),
				message: {
					content: { type: "text" as const, text: "hello" },
					chunks: [{ type: "text" as const, text: "hello" }],
					sentAt: new Date(1),
				},
			},
		};
		const previousGraph = createGraph({
			transcriptSnapshot: {
				revision: 6,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						attemptId: "attempt-1",
						segments: [{ kind: "text", segmentId: "s-1", text: "hello" }],
					},
				],
			},
		});

		const patches = reduceCommand(
			createSnapshot({
				previousGraph,
				transientProjection: {
					acpSessionId: "session-1",
					pendingSendIntent,
					autonomousTransition: "idle",
					statusChangedAt: 1,
				},
			}),
			{
				kind: "applyTranscriptDelta",
				delta: {
					eventSeq: 8,
					sessionId: "session-1",
					snapshotRevision: 7,
					operations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-1",
								role: "assistant",
								segments: [{ kind: "text", segmentId: "a-1", text: "hi" }],
							},
						},
					],
				},
				revision: {
					graphRevision: 10,
					transcriptRevision: 7,
					lastEventSeq: 11,
				},
			},
			1_700_000_000_000
		);

		expect(
			patches.some(
				(patch) =>
					patch.kind === "updateTransientProjection" &&
					patch.updates.pendingSendIntent === null
			)
		).toBe(false);
	});

	it("rejects equal capabilities revisions", () => {
		const patches = reduceCommand(
			createSnapshot({
				previousProjection: createProjection({ revision }),
			}),
			createCapabilitiesCommand(
				{
					models: null,
					modes: null,
					availableCommands: [],
					configOptions: [],
					autonomousEnabled: null,
				},
				revision
			),
			1_700_000_000_000
		);

		expect(patches).toEqual([]);
	});

	it("refreshes snapshot when graph patches arrive without canonical graph", () => {
		const previousProjection = createProjection();

		const patches = reduceCommand(
			createSnapshot({ previousProjection, previousGraph: null }),
			{
				kind: "applyGraphPatches",
				revision: newerRevision,
				activity: undefined,
				turnState: "Completed",
				activeTurnFailure: null,
				lastTerminalTurnId: "turn-1",
				activeStreamingTail: undefined,
				operationPatches: [],
				interactionPatches: [],
			},
			1_700_000_000_000
		);

		expect(patches.some((patch) => patch.kind === "setCanonicalProjection")).toBe(false);
		expect(patches).toEqual(
			expect.arrayContaining([
				{
					kind: "warnMissingCanonicalProjection",
					sessionId: "session-1",
					reason: "graphPatches",
					context: { revision: newerRevision },
				},
				{
					kind: "refreshSessionStateSnapshot",
					sessionId: "session-1",
					reason: "missingCanonicalGraph",
				},
			])
		);
	});

});
