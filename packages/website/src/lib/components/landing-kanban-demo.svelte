<script lang="ts">
import {
	type ActivityEntryQuestion,
	type ActivityEntryQuestionOption,
	type ActivityEntryQuestionProgress,
	KanbanSceneBoard,
	type KanbanSceneCardData,
	type KanbanSceneColumnGroup,
	type KanbanSceneMenuAction,
	type KanbanTaskCardData,
	type KanbanToolData,
} from "@acepe/ui";
import { Terminal } from "phosphor-svelte";

import type { AgentToolEntry } from "@acepe/ui";

import LandingDemoFrame from "./landing-demo-frame.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";

const theme = $derived($websiteThemeStore);

const reviewMenuActions: readonly KanbanSceneMenuAction[] = [
	{ id: "open", label: "Open session" },
	{ id: "diff", label: "Inspect diff" },
];

const questionPrompt: ActivityEntryQuestion = {
	question: "Should I use JWT or session cookies for the new auth layer?",
	multiSelect: false,
	options: [{ label: "JWT" }, { label: "Session cookies" }, { label: "Hybrid rollout" }],
};

const questionOptions: readonly ActivityEntryQuestionOption[] = [
	{ label: "JWT", selected: true, color: "#22C55E" },
	{ label: "Session cookies", selected: false, color: "#9858FF" },
	{ label: "Hybrid rollout", selected: false, color: "#FF8D20" },
];

const questionProgress: readonly ActivityEntryQuestionProgress[] = [
	{ questionIndex: 0, answered: true },
];

const taskToolCalls: readonly AgentToolEntry[] = [
	{
		id: "task-tool-1",
		type: "tool_call",
		kind: "search",
		title: "Search",
		subtitle: "kanban scene adapters",
		status: "done",
	},
	{
		id: "task-tool-2",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "packages/ui/src/components/kanban/kanban-scene-board.svelte",
		status: "running",
	},
];

function createTool(
	id: string,
	title: string,
	status: "running" | "done",
	filePath?: string
): KanbanToolData {
	return {
		id,
		title,
		status,
		filePath,
	};
}

function createTaskCard(summary: string, latestTool: KanbanToolData | null): KanbanTaskCardData {
	return {
		summary,
		isStreaming: true,
		latestTool,
		toolCalls: taskToolCalls,
	};
}

function createCard(params: {
	id: string;
	title: string;
	agentIconSrc: string;
	agentLabel: string;
	projectName: string;
	projectColor: string;
	activityText?: string | null;
	isStreaming?: boolean;
	modeId?: string | null;
	diffInsertions?: number;
	diffDeletions?: number;
	errorText?: string | null;
	todoProgress?: { current: number; total: number; label: string } | null;
	taskCard?: KanbanTaskCardData | null;
	latestTool?: KanbanToolData | null;
	hasUnseenCompletion?: boolean;
	sequenceId?: number | null;
	footer?: KanbanSceneCardData["footer"];
	menuActions?: readonly KanbanSceneMenuAction[];
}): KanbanSceneCardData {
	return {
		id: params.id,
		title: params.title,
		agentIconSrc: params.agentIconSrc,
		agentLabel: params.agentLabel,
		projectName: params.projectName,
		projectColor: params.projectColor,
		activityText: params.activityText ? params.activityText : null,
		isStreaming: params.isStreaming === undefined ? false : params.isStreaming,
		modeId: params.modeId === undefined ? "build" : params.modeId,
		diffInsertions: params.diffInsertions === undefined ? 0 : params.diffInsertions,
		diffDeletions: params.diffDeletions === undefined ? 0 : params.diffDeletions,
		errorText: params.errorText === undefined ? null : params.errorText,
		todoProgress: params.todoProgress === undefined ? null : params.todoProgress,
		taskCard: params.taskCard === undefined ? null : params.taskCard,
		latestTool: params.latestTool === undefined ? null : params.latestTool,
		hasUnseenCompletion:
			params.hasUnseenCompletion === undefined ? false : params.hasUnseenCompletion,
		sequenceId: params.sequenceId === undefined ? null : params.sequenceId,
		footer: params.footer === undefined ? null : params.footer,
		menuActions: params.menuActions === undefined ? [] : params.menuActions,
		showCloseAction: false,
		hideBody: false,
		flushFooter: false,
	};
}

const claudeIcon = $derived(`/svgs/agents/claude/claude-icon-${theme}.svg`);
const codexIcon = $derived(`/svgs/agents/codex/codex-icon-${theme}.svg`);
const cursorIcon = $derived(`/svgs/agents/cursor/cursor-icon-${theme}.svg`);
const opencodeIcon = $derived(`/svgs/agents/opencode/opencode-logo-${theme}.svg`);

const groups = $derived.by((): readonly KanbanSceneColumnGroup[] => {
	return [
		{
			id: "answer_needed",
			label: "Input Needed",
			items: [
				createCard({
					id: "landing-question-card",
					title: "Choose the auth rollout",
					agentIconSrc: claudeIcon,
					agentLabel: "Claude Code",
					projectName: "acepe.dev",
					projectColor: "#9858FF",
					modeId: "plan",
					diffInsertions: 4,
					todoProgress: { current: 1, total: 3, label: "Decide" },
					sequenceId: 7,
					menuActions: reviewMenuActions,
					footer: {
						kind: "question",
						currentQuestion: questionPrompt,
						totalQuestions: 1,
						hasMultipleQuestions: false,
						currentQuestionIndex: 0,
						questionId: "landing-auth-question",
						questionProgress,
						currentQuestionAnswered: true,
						currentQuestionOptions: questionOptions,
						otherText: "",
						otherPlaceholder: "Type custom answer...",
						showOtherInput: true,
						showSubmitButton: false,
						canSubmit: true,
						submitLabel: "Submit",
					},
				}),
			],
		},
		{
			id: "planning",
			label: "Planning",
			items: [
				createCard({
					id: "landing-plan-card",
					title: "Review kanban extraction plan",
					agentIconSrc: cursorIcon,
					agentLabel: "Cursor",
					projectName: "desktop",
					projectColor: "#18D6C3",
					modeId: "plan",
					activityText: "Preparing build handoff…",
					isStreaming: true,
					diffInsertions: 11,
					diffDeletions: 2,
					sequenceId: 12,
					footer: {
						kind: "plan_approval",
						prompt: "Extract the shared renderer and wire website mocks?",
						approveLabel: "Build",
						rejectLabel: "Cancel",
					},
				}),
			],
		},
		{
			id: "working",
			label: "Working",
			items: [
				createCard({
					id: "landing-working-card",
					title: "Render the shared board scene",
					agentIconSrc: codexIcon,
					agentLabel: "Codex",
					projectName: "ui",
					projectColor: "#4AD0FF",
					isStreaming: true,
					diffInsertions: 38,
					diffDeletions: 9,
					todoProgress: { current: 2, total: 5, label: "Extract" },
					taskCard: createTaskCard(
						"Move the kanban composition into a shared presentational scene",
						createTool(
							"task-tool-running",
							"Editing",
							"running",
							"packages/ui/src/components/kanban/kanban-scene-board.svelte"
						)
					),
					sequenceId: 19,
					menuActions: reviewMenuActions,
				}),
				createCard({
					id: "landing-permission-card",
					title: "Run website visual check",
					agentIconSrc: opencodeIcon,
					agentLabel: "OpenCode",
					projectName: "website",
					projectColor: "#FF8D20",
					activityText: "Waiting on execution approval…",
					isStreaming: true,
					diffInsertions: 6,
					diffDeletions: 1,
					sequenceId: 24,
					footer: {
						kind: "permission",
						label: "Execute",
						command: "bun run check && bun test src/routes/landing-hero-assets.test.ts",
						filePath: null,
						toolKind: "execute",
						progress: { current: 1, total: 3, label: "Permission 1" },
						allowAlwaysLabel: "Always allow",
						approveLabel: "Allow",
						rejectLabel: "Deny",
					},
				}),
			],
		},
		{
			id: "needs_review",
			label: "Needs Review",
			items: [
				createCard({
					id: "landing-review-card",
					title: "Landing hero kanban demo",
					agentIconSrc: claudeIcon,
					agentLabel: "Claude Code",
					projectName: "website",
					projectColor: "#9858FF",
					diffInsertions: 52,
					diffDeletions: 14,
					latestTool: createTool(
						"review-tool",
						"Ran",
						"done",
						"packages/website/src/routes/+page.svelte"
					),
					hasUnseenCompletion: true,
					sequenceId: 31,
					menuActions: reviewMenuActions,
				}),
			],
		},
		{
			id: "idle",
			label: "Done",
			items: [
				createCard({
					id: "landing-idle-card",
					title: "Queue layout cleanup",
					agentIconSrc: cursorIcon,
					agentLabel: "Cursor",
					projectName: "desktop",
					projectColor: "#18D6C3",
					diffInsertions: 14,
					diffDeletions: 4,
					todoProgress: { current: 3, total: 3, label: "Complete" },
					latestTool: createTool(
						"idle-tool",
						"Reviewed",
						"done",
						"packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte"
					),
					sequenceId: 34,
				}),
			],
		},
	];
});
</script>

<LandingDemoFrame>
	{#snippet children()}
		<KanbanSceneBoard {groups} emptyHint="No agents">
			{#snippet permissionFooterRenderer(_card: KanbanSceneCardData, permissionFooterData)}
				<div class="rounded-md border border-border/50 bg-muted/25 px-2 py-1.5">
					<div class="flex items-center justify-between gap-2">
						<div class="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
							<Terminal size={11} class="shrink-0 text-[#9858FF]" weight="fill" />
							<span class="truncate">{permissionFooterData.label}</span>
						</div>
						{#if permissionFooterData.progress}
							<span class="shrink-0 text-[10px] text-muted-foreground/80">
								{permissionFooterData.progress.current}/{permissionFooterData.progress.total}
							</span>
						{/if}
					</div>
					{#if permissionFooterData.command}
						<div class="mt-1 rounded bg-background/60 px-2 py-1">
							<code class="block whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/75">
								$ {permissionFooterData.command}
							</code>
						</div>
					{/if}
					<div class="mt-1.5 flex items-center gap-1">
						<span class="rounded bg-emerald-500/12 px-2 py-1 text-[10px] font-medium text-emerald-300">
							{permissionFooterData.approveLabel}
						</span>
						<span class="rounded bg-amber-500/12 px-2 py-1 text-[10px] font-medium text-amber-200">
							{permissionFooterData.allowAlwaysLabel}
						</span>
						<span class="rounded bg-rose-500/12 px-2 py-1 text-[10px] font-medium text-rose-300">
							{permissionFooterData.rejectLabel}
						</span>
					</div>
				</div>
			{/snippet}
		</KanbanSceneBoard>
	{/snippet}
</LandingDemoFrame>
