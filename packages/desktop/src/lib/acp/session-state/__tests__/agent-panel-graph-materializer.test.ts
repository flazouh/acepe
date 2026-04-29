import { describe, expect, it } from "bun:test";
import type {
	OperationSnapshot,
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import {
	AGENT_PANEL_SCENE_TEXT_LIMITS,
	materializeAgentPanelSceneFromGraph,
} from "../agent-panel-graph-materializer.js";

function createActionability(): SessionGraphActionability {
	return {
		canSend: true,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "send",
		recoveryPhase: "none",
		compactStatus: "ready",
	};
}

function createLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		actionability: createActionability(),
	};
}

function createActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

function createTranscriptEntry(
	entryId: string,
	role: TranscriptEntry["role"],
	text: string
): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [
			{
				kind: "text",
				segmentId: `${entryId}-segment-1`,
				text,
			},
		],
	};
}

function createTranscriptSnapshot(entries: TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: 7,
		entries,
	};
}

function createOperationSnapshot(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
	return {
		id: overrides.id ?? "op:session-1:tool-1",
		session_id: overrides.session_id ?? "session-1",
		tool_call_id: overrides.tool_call_id ?? "tool-1",
		name: overrides.name ?? "bash",
		kind: overrides.kind ?? "execute",
		provider_status: overrides.provider_status ?? "completed",
		title: overrides.title ?? "Run",
		arguments: overrides.arguments ?? { kind: "execute", command: "bun test" },
		progressive_arguments: overrides.progressive_arguments ?? null,
		result: overrides.result ?? { stdout: "ok", stderr: null, exitCode: 0 },
		command: overrides.command ?? "bun test",
		normalized_todos: overrides.normalized_todos ?? null,
		parent_tool_call_id: overrides.parent_tool_call_id ?? null,
		parent_operation_id: overrides.parent_operation_id ?? null,
		child_tool_call_ids: overrides.child_tool_call_ids ?? [],
		child_operation_ids: overrides.child_operation_ids ?? [],
		operation_provenance_key: overrides.operation_provenance_key ?? "tool-1",
		operation_state: overrides.operation_state ?? "completed",
		locations: overrides.locations ?? null,
		skill_meta: overrides.skill_meta ?? null,
		normalized_questions: overrides.normalized_questions ?? null,
		question_answer: overrides.question_answer ?? null,
		awaiting_plan_approval: overrides.awaiting_plan_approval ?? false,
		plan_approval_request_id: overrides.plan_approval_request_id ?? null,
		started_at_ms: overrides.started_at_ms ?? null,
		completed_at_ms: overrides.completed_at_ms ?? null,
		source_link: overrides.source_link ?? {
			kind: "transcript_linked",
			entry_id: "tool-1",
		},
		degradation_reason: overrides.degradation_reason ?? null,
	};
}

function createGraph(input: {
	transcriptSnapshot: TranscriptSnapshot;
	operations?: OperationSnapshot[];
	turnState?: SessionStateGraph["turnState"];
	lifecycle?: SessionGraphLifecycle;
	activity?: SessionGraphActivity;
}): SessionStateGraph {
	const lifecycle = input.lifecycle ?? createLifecycle();
	const activity = input.activity ?? createActivity();
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 9,
			transcriptRevision: input.transcriptSnapshot.revision,
			lastEventSeq: 42,
		},
		transcriptSnapshot: input.transcriptSnapshot,
		operations: input.operations ?? [],
		interactions: [],
		turnState: input.turnState ?? "Completed",
		messageCount: input.transcriptSnapshot.entries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle,
		activity,
		capabilities: createCapabilities(),
	};
}

describe("agent panel graph materializer", () => {
	it("materializes rich tool entries from canonical operations instead of transcript placeholders", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "Run the checks"),
			createTranscriptEntry("tool-1", "tool", "Run"),
			createTranscriptEntry("assistant-1", "assistant", "Checks are green."),
		]);
		const graph = createGraph({
			transcriptSnapshot,
			operations: [createOperationSnapshot()],
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.status).toBe("done");
		expect(scene.conversation.entries[0]).toEqual({
			id: "user-1",
			type: "user",
			text: "Run the checks",
		});
		expect(scene.conversation.entries[1]).toMatchObject({
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "bun test",
			stdout: "ok",
			status: "done",
			presentationState: "resolved",
		});
		expect(scene.conversation.entries[2]).toEqual({
			id: "assistant-1",
			type: "assistant",
			markdown: "Checks are green.",
			isStreaming: undefined,
		});
	});

	it("preserves lifecycle actionability and resume actions in the scene contract", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("assistant-1", "assistant", "Restored history."),
			]),
			turnState: "Idle",
			lifecycle: {
				status: "detached",
				detachedReason: "restoredRequiresAttach",
				failureReason: null,
				errorMessage: null,
				actionability: {
					canSend: false,
					canResume: true,
					canRetry: false,
					canArchive: true,
					canConfigure: false,
					recommendedAction: "resume",
					recoveryPhase: "detached",
					compactStatus: "detached",
				},
			},
			activity: {
				kind: "paused",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.status).toBe("idle");
		expect(scene.lifecycle).toMatchObject({
			status: "detached",
			detachedReason: "restoredRequiresAttach",
			actionability: {
				canResume: true,
				recommendedAction: "resume",
				recoveryPhase: "detached",
			},
		});
		expect(scene.header.actions).toEqual([
			{
				id: "status.resume",
				label: "Resume",
				state: "enabled",
			},
			{
				id: "status.archive",
				label: "Archive",
				state: "enabled",
			},
		]);
	});

	it("surfaces canonical turn failures as error status before lifecycle catches up", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("assistant-1", "assistant", "Rate limited."),
			]),
			turnState: "Failed",
			lifecycle: createLifecycle(),
			activity: {
				kind: "error",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.status).toBe("error");
		expect(scene.header.status).toBe("error");
	});

	it("renders committed missing-operation tool rows as explicit degraded presentation", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-missing", "tool", "Provider said a tool ran"),
			]),
			operations: [],
			turnState: "Completed",
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.conversation.entries[0]).toMatchObject({
			id: "tool-missing",
			type: "tool_call",
			kind: "other",
			status: "degraded",
			title: "Unresolved tool",
			subtitle: "Provider said a tool ran",
			presentationState: "degraded_operation",
			degradedReason: "No canonical operation was found for this restored transcript tool row.",
		});
	});

	it("does not join transcript rows through coincidental operation ids", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-coincidental", "tool", "Provider said a tool ran"),
			]),
			operations: [
				createOperationSnapshot({
					id: "tool-coincidental",
					tool_call_id: "tool-coincidental",
					operation_provenance_key: "tool-coincidental",
					source_link: {
						kind: "synthetic",
						reason: "synthetic_test_operation",
					},
				}),
			],
			turnState: "Completed",
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.conversation.entries[0]).toMatchObject({
			id: "tool-coincidental",
			type: "tool_call",
			kind: "other",
			status: "degraded",
			title: "Unresolved tool",
			presentationState: "degraded_operation",
		});
	});

	it("uses canonical operation state instead of provider status for presentation", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-1", "tool", "Run"),
			]),
			operations: [
				createOperationSnapshot({
					provider_status: "completed",
					operation_state: "degraded",
					degradation_reason: {
						code: "classification_failure",
						detail: "Tool classification was insufficient for canonical presentation.",
					},
				}),
			],
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.conversation.entries[0]).toMatchObject({
			id: "tool-1",
			type: "tool_call",
			status: "degraded",
			presentationState: "degraded_operation",
			degradedReason: "Tool operation could not be classified safely.",
		});
	});

	it("renders blocked from canonical operation state even when provider status is stale", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([createTranscriptEntry("tool-1", "tool", "Run")]),
			operations: [
				createOperationSnapshot({
					provider_status: "completed",
					operation_state: "blocked",
				}),
			],
			turnState: "Running",
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});

		expect(scene.conversation.entries[0]).toMatchObject({
			id: "tool-1",
			type: "tool_call",
			status: "blocked",
			presentationState: "resolved",
		});
	});

	it("keeps live transcript-before-operation races pending until canonical operation data arrives", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-live", "tool", "Run"),
			]),
			operations: [],
			turnState: "Running",
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Live session",
			},
		});

		expect(scene.conversation.entries[0]).toMatchObject({
			id: "tool-live",
			type: "tool_call",
			kind: "other",
			status: "pending",
			title: "Tool pending",
			presentationState: "pending_operation",
		});
	});

	it("recursively materializes task children from canonical child operations", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("task-entry", "tool", "Task completed"),
		]);
		const parentOperation = createOperationSnapshot({
			id: "operation-parent",
			tool_call_id: "task-tool",
			name: "task",
			kind: "task",
			title: "Task completed",
			arguments: {
				kind: "think",
				description: "Run subagent",
				prompt: "Investigate",
				subagent_type: "general-purpose",
				skill: null,
				skill_args: null,
				raw: null,
			},
			result: "done",
			command: null,
			child_tool_call_ids: ["child-tool"],
			child_operation_ids: ["operation-child"],
			operation_provenance_key: "task-tool",
			source_link: {
				kind: "transcript_linked",
				entry_id: "task-entry",
			},
		});
		const childOperation = createOperationSnapshot({
			id: "operation-child",
			tool_call_id: "child-tool",
			name: "bash",
			kind: "execute",
			title: "Run",
			arguments: { kind: "execute", command: "bun test src/lib/acp" },
			result: { stdout: "child ok", stderr: null, exitCode: 0 },
			command: "bun test src/lib/acp",
			parent_tool_call_id: "task-tool",
			parent_operation_id: "operation-parent",
			child_tool_call_ids: [],
			child_operation_ids: [],
			operation_provenance_key: "child-tool",
			source_link: {
				kind: "synthetic",
				reason: "task_child_operation",
			},
		});
		const graph = createGraph({
			transcriptSnapshot,
			operations: [parentOperation, childOperation],
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});
		const taskEntry = scene.conversation.entries[0];
		if (taskEntry.type !== "tool_call" || !taskEntry.taskChildren) {
			throw new Error("Expected task tool with children");
		}

		expect(taskEntry).toMatchObject({
			type: "tool_call",
			kind: "task",
			taskDescription: "Run subagent",
			taskResultText: "done",
			presentationState: "resolved",
		});
		expect(taskEntry.taskChildren[0]).toMatchObject({
			type: "tool_call",
			kind: "execute",
			command: "bun test src/lib/acp",
			stdout: "child ok",
			status: "done",
			presentationState: "resolved",
		});
	});

	it("bounds display output before values enter scene DTOs", () => {
		const longOutput = "x".repeat(AGENT_PANEL_SCENE_TEXT_LIMITS.output + 100);
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-1", "tool", "Run"),
			]),
			operations: [
				createOperationSnapshot({
					result: { stdout: longOutput, stderr: null, exitCode: 0 },
				}),
			],
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: {
				title: "Restored session",
			},
		});
		const entry = scene.conversation.entries[0];
		if (entry.type !== "tool_call") {
			throw new Error("Expected tool entry");
		}

		expect(entry.stdout?.length).toBeLessThan(longOutput.length);
		expect(entry.stdout?.endsWith("[truncated]")).toBe(true);
	});
});
