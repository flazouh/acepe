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
	applySceneTextLimits,
	materializeAgentPanelSceneFromGraph,
} from "../agent-panel-graph-materializer.js";
import type { AgentToolEntry } from "@acepe/ui/agent-panel";

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

	it("preserves editDiffs through scene text limit filtering for edit tool calls", () => {
		const transcriptSnapshot = createTranscriptSnapshot([
			createTranscriptEntry("user-1", "user", "Apply the patch"),
			createTranscriptEntry("tool-edit", "tool", "Edit"),
		]);
		const graph = createGraph({
			transcriptSnapshot,
			operations: [
				createOperationSnapshot({
					id: "op:session-1:tool-edit",
					tool_call_id: "tool-edit",
					name: "Edit",
					kind: "edit",
					title: "Edit",
					command: null,
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/repo/foo.ts",
								oldString: "const x = 1;",
								newString: "const x = 2;",
							},
						],
					},
					result: null,
					source_link: { kind: "transcript_linked", entry_id: "tool-edit" },
				}),
			],
		});

		const scene = materializeAgentPanelSceneFromGraph({
			panelId: "panel-1",
			graph,
			header: { title: "Edit session" },
		});

		const editEntry = scene.conversation.entries.find(
			(entry) => entry.type === "tool_call" && entry.kind === "edit"
		);
		expect(editEntry).toBeDefined();
		expect(editEntry).toMatchObject({
			kind: "edit",
			editDiffs: [
				{
					filePath: "/repo/foo.ts",
					oldString: "const x = 1;",
					newString: "const x = 2;",
				},
			],
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

	it("renders valid unclassified operations without degraded warning styling", () => {
		const graph = createGraph({
			transcriptSnapshot: createTranscriptSnapshot([
				createTranscriptEntry("tool-1", "tool", "write_bash"),
			]),
			operations: [
				createOperationSnapshot({
					name: "write_bash",
					kind: "unclassified",
					title: "",
					arguments: {
						kind: "unclassified",
						raw_name: "write_bash",
						raw_kind_hint: null,
						title: null,
						arguments_preview: null,
						signals_tried: ["ProviderNameMap", "ArgumentShape"],
					},
					provider_status: "completed",
					operation_state: "completed",
					degradation_reason: null,
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
			kind: "other",
			status: "done",
			title: "Write Bash",
			presentationState: "resolved",
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

	it("applySceneTextLimits passes through every populated AgentToolEntry field unchanged except the declared truncation targets", () => {
		const fullEntry: AgentToolEntry = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Run build",
			subtitle: "in repo root",
			detailsText: "short details",
			scriptText: "echo hello",
			editDiffs: [
				{
					filePath: "/repo/foo.ts",
					oldString: "a",
					newString: "b",
				},
			],
			filePath: "/repo/foo.ts",
			sourceExcerpt: "const x = 1;",
			sourceRangeLabel: "L1-L1",
			status: "done",
			command: "bun run build",
			stdout: "build ok",
			stderr: "",
			exitCode: 0,
			query: "needle",
			searchPath: "/repo",
			searchFiles: ["/repo/a.ts", "/repo/b.ts"],
			searchResultCount: 2,
			searchMode: "content",
			searchNumFiles: 2,
			searchNumMatches: 4,
			searchMatches: [
				{
					filePath: "/repo/a.ts",
					fileName: "a.ts",
					lineNumber: 1,
					content: "needle",
					isMatch: true,
				},
			],
			url: "https://example.com",
			resultText: "result body",
			webSearchLinks: [
				{ title: "T", url: "https://example.com", domain: "example.com" },
			],
			webSearchSummary: "summary",
			skillName: "ce-debug",
			skillArgs: "--quick",
			skillDescription: "debug",
			taskDescription: "task desc",
			taskPrompt: "task prompt",
			taskResultText: "task result",
			taskChildren: [
				{
					id: "child-1",
					type: "tool_call",
					title: "Child tool",
					status: "done",
				},
			],
			presentationState: "resolved",
			degradedReason: null,
			todos: [{ content: "do it", status: "pending" }],
			question: { question: "Pick one", options: [{ label: "A" }] },
			lintDiagnostics: [
				{ filePath: "/repo/a.ts", line: 1, severity: "error", message: "boom" },
			],
		};

		const limited = applySceneTextLimits(fullEntry);

		// Every key present in the input must be present in the output.
		// This is the structural contract that protects against the allow-list
		// footgun: if someone reverts to manual rebuild and forgets a field,
		// this check fails for that field.
		for (const key of Object.keys(fullEntry) as Array<keyof AgentToolEntry>) {
			expect(limited).toHaveProperty(key);
		}

		// Non-truncated fields are pass-through (reference-equal where applicable).
		expect(limited.id).toBe(fullEntry.id);
		expect(limited.kind).toBe(fullEntry.kind);
		expect(limited.title).toBe(fullEntry.title);
		expect(limited.subtitle).toBe(fullEntry.subtitle);
		expect(limited.scriptText).toBe(fullEntry.scriptText);
		expect(limited.editDiffs).toBe(fullEntry.editDiffs);
		expect(limited.filePath).toBe(fullEntry.filePath);
		expect(limited.sourceExcerpt).toBe(fullEntry.sourceExcerpt);
		expect(limited.sourceRangeLabel).toBe(fullEntry.sourceRangeLabel);
		expect(limited.status).toBe(fullEntry.status);
		expect(limited.command).toBe(fullEntry.command);
		expect(limited.exitCode).toBe(fullEntry.exitCode);
		expect(limited.query).toBe(fullEntry.query);
		expect(limited.searchPath).toBe(fullEntry.searchPath);
		expect(limited.searchFiles).toBe(fullEntry.searchFiles);
		expect(limited.searchResultCount).toBe(fullEntry.searchResultCount);
		expect(limited.searchMode).toBe(fullEntry.searchMode);
		expect(limited.searchNumFiles).toBe(fullEntry.searchNumFiles);
		expect(limited.searchNumMatches).toBe(fullEntry.searchNumMatches);
		expect(limited.searchMatches).toBe(fullEntry.searchMatches);
		expect(limited.url).toBe(fullEntry.url);
		expect(limited.webSearchLinks).toBe(fullEntry.webSearchLinks);
		expect(limited.webSearchSummary).toBe(fullEntry.webSearchSummary);
		expect(limited.skillName).toBe(fullEntry.skillName);
		expect(limited.skillArgs).toBe(fullEntry.skillArgs);
		expect(limited.skillDescription).toBe(fullEntry.skillDescription);
		expect(limited.taskDescription).toBe(fullEntry.taskDescription);
		expect(limited.taskPrompt).toBe(fullEntry.taskPrompt);
		expect(limited.presentationState).toBe(fullEntry.presentationState);
		expect(limited.degradedReason).toBe(fullEntry.degradedReason);
		expect(limited.todos).toBe(fullEntry.todos);
		expect(limited.question).toBe(fullEntry.question);
		expect(limited.lintDiagnostics).toBe(fullEntry.lintDiagnostics);

		// Truncation targets pass through unchanged when under the limit.
		expect(limited.detailsText).toBe(fullEntry.detailsText);
		expect(limited.stdout).toBe(fullEntry.stdout);
		expect(limited.stderr).toBe(fullEntry.stderr);
		expect(limited.resultText).toBe(fullEntry.resultText);
		expect(limited.taskResultText).toBe(fullEntry.taskResultText);

		// taskChildren is rebuilt (recursion) but contents preserved by identity for non-tool children
		// and structurally for tool children.
		expect(limited.taskChildren).toHaveLength(1);
		expect(limited.taskChildren?.[0]).toMatchObject({
			id: "child-1",
			type: "tool_call",
			title: "Child tool",
		});
	});

	it("applySceneTextLimits preserves empty arrays as empty arrays (does not nullify)", () => {
		const entry: AgentToolEntry = {
			id: "tool-empty",
			type: "tool_call",
			title: "Empty",
			status: "done",
			editDiffs: [],
			searchFiles: [],
			todos: [],
		};

		const limited = applySceneTextLimits(entry);

		expect(limited.editDiffs).toEqual([]);
		expect(limited.searchFiles).toEqual([]);
		expect(limited.todos).toEqual([]);
	});
});
