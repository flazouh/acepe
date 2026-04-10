import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { FilePanel } from "../../../store/file-panel-type.js";
import type { SessionPlanResponse } from "../../../../services/claude-history.js";
import {
	buildDesktopAgentPanelScene,
	buildDesktopComposerModel,
	buildDesktopPlanSidebar,
	mapSessionEntriesToConversationModel,
	mapSessionStatusToSceneStatus,
	mapVirtualizedDisplayEntryToConversationEntry,
} from "./desktop-agent-panel-scene.js";

describe("desktop agent panel scene adapter", () => {
	it("maps session status into scene status", () => {
		expect(mapSessionStatusToSceneStatus("connecting", 0)).toBe("warming");
		expect(mapSessionStatusToSceneStatus("streaming", 3)).toBe("running");
		expect(mapSessionStatusToSceneStatus("ready", 3)).toBe("connected");
		expect(mapSessionStatusToSceneStatus("idle", 0)).toBe("empty");
	});

	it("maps desktop session entries into scene conversation entries", () => {
		const entries: SessionEntry[] = [
			{
				id: "user-1",
				type: "user",
				message: {
					content: { type: "text", text: "Migrate auth to JWT" },
					chunks: [{ type: "text", text: "Migrate auth to JWT" }],
				},
			},
			{
				id: "tool-1",
				type: "tool_call",
				message: {
					id: "tool-1",
					name: "bash",
					arguments: { kind: "execute", command: "bun test src/lib/auth" },
					rawInput: null,
					status: "completed",
					result: {
						stdout: "ok",
						stderr: "",
						exitCode: 0,
					},
					kind: "execute",
					title: "Run",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "assistant-1",
				type: "assistant",
				isStreaming: true,
				message: {
					chunks: [{ type: "message", block: { type: "text", text: "JWT service is ready." } }],
					displayModel: "Claude Sonnet",
				},
			},
			{
				id: "ask-1",
				type: "ask",
				message: {
					id: "ask-1",
					question: "Ship this now?",
					description: "Need your approval before merging.",
					options: [{ id: "yes", label: "Yes" }, { id: "later", label: "Later" }],
				},
			},
			{
				id: "error-1",
				type: "error",
				message: {
					content: "Connection dropped",
					code: "EPIPE",
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "streaming");

		expect(conversation.entries).toHaveLength(5);
		expect(conversation.isStreaming).toBe(true);
		expect(conversation.entries[0]).toEqual({
			id: "user-1",
			type: "user",
			text: "Migrate auth to JWT",
		});
		expect(conversation.entries[1]).toMatchObject({
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			status: "done",
			command: "bun test src/lib/auth",
		});
		expect(conversation.entries[2]).toEqual({
			id: "assistant-1",
			type: "assistant",
			markdown: "JWT service is ready.",
			isStreaming: true,
		});
	});

	it("excludes assistant thought chunks from flattened markdown", () => {
		const entries: SessionEntry[] = [
			{
				id: "assistant-1",
				type: "assistant",
				message: {
					chunks: [
						{ type: "thought", block: { type: "text", text: "Thinking..." } },
						{ type: "message", block: { type: "text", text: "Final answer" } },
					],
					displayModel: "Claude Sonnet",
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "streaming");

		expect(conversation.entries[0]).toEqual({
			id: "assistant-1",
			type: "assistant",
			markdown: "Final answer",
		});
	});

	it("preserves rich tool payloads in scene entries", () => {
		const entries: SessionEntry[] = [
			{
				id: "search-1",
				type: "tool_call",
				message: {
					id: "search-1",
					name: "rg",
					arguments: { kind: "search", query: "jwt", file_path: "src/lib/auth.ts" },
					rawInput: null,
					status: "completed",
					result: {
						mode: "files_with_matches",
						filenames: ["src/lib/auth.ts", "src/routes/login.ts"],
					},
					kind: "search",
					title: "Search",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "fetch-1",
				type: "tool_call",
				message: {
					id: "fetch-1",
					name: "fetch",
					arguments: { kind: "fetch", url: "https://acepe.dev/docs" },
					rawInput: null,
					status: "completed",
					result: "Fetched docs body",
					kind: "fetch",
					title: "Fetch",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "web-1",
				type: "tool_call",
				message: {
					id: "web-1",
					name: "webSearch",
					arguments: { kind: "webSearch", query: "acepe agent panel" },
					rawInput: null,
					status: "completed",
					result: {
						summary: "Found references",
						search_results: [{ title: "Acepe", url: "https://acepe.dev" }],
					},
					kind: "web_search",
					title: "Web search",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "lint-1",
				type: "tool_call",
				message: {
					id: "lint-1",
					name: "read_lints",
					arguments: { kind: "other", raw: {} },
					rawInput: null,
					status: "completed",
					result: {
						totalDiagnostics: 1,
						totalFiles: 1,
						diagnostics: [
							{ filePath: "src/lib/auth.ts", line: 42, message: "Boom", severity: "error" },
						],
					},
					kind: "read_lints",
					title: "Read lints",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "lint-alias-1",
				type: "tool_call",
				message: {
					id: "lint-alias-1",
					name: "read_lints",
					arguments: { kind: "read", file_path: "/tmp/lints.json" },
					rawInput: null,
					status: "completed",
					result: {
						diagnostics: [
							{
								file_path: "src/routes/+page.svelte",
								lineNumber: 7,
								message: "Unused export",
								severity: "warning",
							},
						],
					},
					kind: "read",
					title: "Read Lints",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
			{
				id: "task-output-1",
				type: "tool_call",
				message: {
					id: "task-output-1",
					name: "task_output",
					arguments: { kind: "taskOutput", task_id: "subagent-1", timeout: null },
					rawInput: null,
					status: "completed",
					result: "subagent finished",
					kind: "task_output",
					title: "Task output",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "idle");

		expect(conversation.entries[0]).toMatchObject({
			type: "tool_call",
			kind: "search",
			searchFiles: ["src/lib/auth.ts", "src/routes/login.ts"],
			searchResultCount: 2,
		});
		expect(conversation.entries[1]).toMatchObject({
			type: "tool_call",
			kind: "fetch",
			resultText: "Fetched docs body",
		});
		expect(conversation.entries[2]).toMatchObject({
			type: "tool_call",
			kind: "web_search",
			webSearchSummary: "Found references",
		});
		expect(conversation.entries[3]).toMatchObject({
			type: "tool_call",
			lintDiagnostics: [
				{
					filePath: "src/lib/auth.ts",
					line: 42,
					message: "Boom",
					severity: "error",
				},
			],
		});
		expect(conversation.entries[4]).toMatchObject({
			type: "tool_call",
			lintDiagnostics: [
				{
					filePath: "src/routes/+page.svelte",
					line: 7,
					message: "Unused export",
					severity: "warning",
				},
			],
		});
		expect(conversation.entries[5]).toMatchObject({
			type: "tool_call",
			kind: "task_output",
			taskDescription: "Task: subagent-1",
			taskResultText: "subagent finished",
		});
	});

	it("marks task children done when the parent task has completed", () => {
		const entries: SessionEntry[] = [
			{
				id: "task-1",
				type: "tool_call",
				message: {
					id: "task-1",
					name: "task",
					arguments: {
						kind: "think",
						description: "Run subagent",
						prompt: "Investigate",
						subagent_type: "general-purpose",
						skill: null,
						skill_args: null,
						raw: null,
					},
					rawInput: null,
					status: "completed",
					result: "done",
					kind: "task",
					title: "Task completed",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: [
						{
							id: "child-search-1",
							name: "search",
							arguments: { kind: "search", query: "jwt", file_path: "src/lib/auth.ts" },
							rawInput: null,
							status: "in_progress",
							result: null,
							kind: "search",
							title: "Search",
							locations: null,
							skillMeta: null,
							normalizedQuestions: null,
							normalizedTodos: null,
							parentToolUseId: "task-1",
							taskChildren: null,
							questionAnswer: null,
							awaitingPlanApproval: false,
							planApprovalRequestId: null,
						},
					],
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "streaming");
		const taskEntry = conversation.entries[0];

		expect(taskEntry).toMatchObject({
			type: "tool_call",
			kind: "task",
			status: "done",
		});

		if (taskEntry.type !== "tool_call" || !taskEntry.taskChildren) {
			throw new Error("Expected task children to be mapped");
		}

		expect(taskEntry.taskChildren[0]).toMatchObject({
			type: "tool_call",
			kind: "search",
			status: "done",
		});
	});

	it("builds composer and sidebars into a desktop scene model", () => {
		const plan: SessionPlanResponse = {
			slug: "jwt-migration",
			title: "JWT migration plan",
			summary: "Replace session auth and rotate refresh tokens.",
			content: "# JWT migration plan\n\n1. Create JWT service\n2. Replace session middleware\n- [x] Audit current auth flow",
			filePath: "/tmp/jwt-migration.md",
		};

		const filePanels: FilePanel[] = [
			{
				id: "panel-1",
				kind: "file",
				filePath: "src/lib/auth/jwt.ts",
				projectPath: "/repo",
				ownerPanelId: "agent-panel-1",
				width: 480,
			},
		];

		const composer = buildDesktopComposerModel({
			draftText: "Continue with refresh token rotation",
			placeholder: "Ask the agent to continue…",
			submitLabel: "Send",
			canSubmit: true,
			selectedModelId: "claude-sonnet-4.5",
			selectedModelLabel: "Claude Sonnet 4.5",
			projectLabel: "acepe",
			showStop: false,
		});

		const scene = buildDesktopAgentPanelScene({
			panelId: "agent-panel-1",
			sessionStatus: "ready",
			entries: [],
			turnState: "idle",
			header: {
				title: "Migrate auth to JWT",
				agentLabel: "Claude Code",
				projectLabel: "acepe",
				projectColor: "#7C3AED",
			},
			composer: {
				draftText: composer.draftText,
				placeholder: composer.placeholder,
				submitLabel: composer.submitLabel,
				canSubmit: composer.canSubmit,
				selectedModelId: composer.selectedModel?.id ?? null,
				selectedModelLabel: composer.selectedModel?.label ?? null,
				projectLabel: composer.selectedModel?.projectLabel ?? null,
			},
			modifiedFilesState: {
				files: [],
				byPath: new Map(),
				fileCount: 3,
				totalEditCount: 12,
			},
			plan,
			showPlanSidebar: false,
			attachedFilePanels: filePanels,
			activeAttachedFilePanelId: "panel-1",
			prCard: {
				description: "Ready for review",
				filesChanged: 3,
				checksLabel: "Passing",
			},
		});

		expect(scene.header.title).toBe("Migrate auth to JWT");
		expect(scene.status).toBe("connected");
		expect(scene.composer?.selectedModel?.label).toBe("Claude Sonnet 4.5");
		expect(scene.sidebars?.plan).toBeNull();
		expect(scene.sidebars?.attachedFiles?.tabs[0]?.title).toBe("jwt.ts");
		expect(scene.sidebars?.attachedFiles?.tabs[0]?.selectActionId).toBe(
			"attachment.selectTab:panel-1"
		);
		expect(scene.strips?.some((strip) => strip.kind === "plan_header")).toBe(true);
		expect(scene.strips?.some((strip) => strip.kind === "modified_files")).toBe(true);
		expect(scene.cards?.some((card) => card.kind === "pr_status")).toBe(true);
	});

	it("omits the plan sidebar when the desktop plan pane is collapsed", () => {
		const scene = buildDesktopAgentPanelScene({
			panelId: "agent-panel-1",
			sessionStatus: "ready",
			entries: [],
			turnState: "idle",
			header: {
				title: "Migrate auth to JWT",
			},
			plan: {
				slug: "plan-1",
				title: "JWT migration plan",
				summary: null,
				content: "- [ ] Ship scene model",
				filePath: null,
			},
			showPlanSidebar: false,
		});

		expect(scene.sidebars?.plan).toBeNull();
		expect(scene.strips?.some((strip) => strip.kind === "plan_header")).toBe(true);
	});

	it("derives plan sidebar items from markdown content", () => {
		const planSidebar = buildDesktopPlanSidebar({
			slug: "test-plan",
			title: "Plan title",
			summary: "Plan summary",
			content: "# Plan title\n\n- [x] Shipped unit 1\n- [-] Wire unit 2\n- [ ] Finish unit 3",
			filePath: null,
		});

		expect(planSidebar?.items).toEqual([
			{
				id: "plan-checkbox-1",
				label: "Shipped unit 1",
				status: "done",
			},
			{
				id: "plan-checkbox-2",
				label: "Wire unit 2",
				status: "in_progress",
			},
			{
				id: "plan-checkbox-3",
				label: "Finish unit 3",
				status: "pending",
			},
		]);
	});

	it("maps merged virtualized assistant entries into shared conversation entries", () => {
		const entry = mapVirtualizedDisplayEntryToConversationEntry(
			{
				type: "assistant_merged_thoughts",
				key: "assistant-merged",
				memberIds: ["assistant-1", "assistant-2"],
				message: {
					chunks: [
						{ type: "thought", block: { type: "text", text: "Thinking…" } },
						{ type: "message", block: { type: "text", text: "Done." } },
					],
				},
				isStreaming: true,
			},
			"streaming",
			true
		);

		expect(entry).toEqual({
			id: "assistant-merged",
			type: "assistant",
			markdown: "Thinking…Done.",
			isStreaming: true,
		});
	});
});
