<script lang="ts">
import * as m from "$lib/messages.js";
import { ArrowRightIcon, BrandLockup, BrandShaderBackground, PillButton } from "@acepe/ui";
import { CheckpointTimeline } from "@acepe/ui/checkpoint";
import { PlanCard } from "@acepe/ui/plan-card";
import { AgentSelectionGrid } from "@acepe/ui/agent-panel";
import type { AgentGridItem } from "@acepe/ui/agent-panel";
import { AppTabBar, AppSessionItem as AppSessionItemComponent } from "@acepe/ui/app-layout";
import type { AppTab, AppSessionItemType } from "@acepe/ui/app-layout";
import { SqlStudioDataGrid } from "@acepe/ui/sql-studio";
import { SectionedFeed, ActivityEntry } from "@acepe/ui/attention-queue";
import type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryQuestionOption,
	ActivityEntryQuestionProgress,
	ActivityEntryTodoProgress,
	SectionedFeedGroup,
	SectionedFeedItemData,
} from "@acepe/ui/attention-queue";
import AgentIconsRow from "$lib/components/agent-icons-row.svelte";
import Header from "$lib/components/header.svelte";
import FeatureShowcase from "$lib/components/feature-showcase.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";
import {
	Stack,
	ArrowsOutSimple,
	GitBranch,
	HardDrives,
	Queue,
	Command,
	ClockCounterClockwise,
	Lightning,
	Check,
	MagnifyingGlass,
	GithubLogo,
} from "phosphor-svelte";

let { data } = $props();

// === Mock data for real component showcases ===

const theme = $derived($websiteThemeStore);

const mockGridAgents: AgentGridItem[] = $derived([
	{
		id: "claude-code",
		name: "Claude Code",
		iconSrc: `/svgs/agents/claude/claude-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "codex",
		name: "Codex",
		iconSrc: `/svgs/agents/codex/codex-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "cursor",
		name: "Cursor",
		iconSrc: `/svgs/agents/cursor/cursor-icon-${theme}.svg`,
		available: true,
	},
	{
		id: "opencode",
		name: "OpenCode",
		iconSrc: `/svgs/agents/opencode/opencode-logo-${theme}.svg`,
		available: true,
	},
]);

const mockTabs: AppTab[] = [
	{
		id: "1",
		title: "Fix login flow",
		projectName: "backend",
		projectColor: "#3b82f6",
		mode: "build",
		status: "running",
		isFocused: true,
	},
	{
		id: "2",
		title: "Write unit tests",
		projectName: "backend",
		projectColor: "#3b82f6",
		mode: "build",
		status: "done",
		isFocused: false,
	},
	{
		id: "3",
		title: "Plan API redesign",
		projectName: "api",
		projectColor: "#f97316",
		mode: "plan",
		status: "question",
		isFocused: false,
	},
];

const mockPlanContent = `Implementation Plan

1. Add rate limiting middleware
- Use token bucket algorithm
- Configure per-endpoint limits

2. Update API routes
- Apply middleware to public endpoints
- Skip for internal service calls

3. Add monitoring
- Track rate limit hits per endpoint
- Alert on sustained high rejection rates`;

const mockCheckpoints = [
	{
		id: "cp-1",
		number: 1,
		message: "Initial scaffold",
		timestamp: Date.now() - 3600000,
		fileCount: 3,
		totalInsertions: 42,
		totalDeletions: 0,
		isAuto: true,
	},
	{
		id: "cp-2",
		number: 2,
		message: "Add auth module",
		timestamp: Date.now() - 1800000,
		fileCount: 5,
		totalInsertions: 120,
		totalDeletions: 18,
		isAuto: false,
	},
	{
		id: "cp-3",
		number: 3,
		message: "Refactor middleware",
		timestamp: Date.now() - 120000,
		fileCount: 4,
		totalInsertions: 23,
		totalDeletions: 8,
		isAuto: true,
	},
];

const mockSessions: AppSessionItemType[] = [
	{
		id: "s1",
		title: "Fix auth middleware",
		status: "running",
		isActive: true,
	},
	{
		id: "s2",
		title: "Write API tests",
		status: "done",
		isActive: false,
	},
	{
		id: "s3",
		title: "Migrate database",
		status: "done",
		isActive: false,
	},
	{
		id: "s4",
		title: "Update README",
		status: "done",
		isActive: false,
	},
];

interface MockQueueItem {
	readonly mode: ActivityEntryMode;
	readonly title: string;
	readonly timeAgo: string | null;
	readonly insertions: number;
	readonly deletions: number;
	readonly isStreaming: boolean;
	readonly fileToolDisplayText: string | null;
	readonly statusText: string | null;
	readonly showToolShimmer?: boolean;
	readonly todoProgress?: ActivityEntryTodoProgress;
	readonly currentQuestion?: ActivityEntryQuestion;
	readonly totalQuestions?: number;
	readonly hasMultipleQuestions?: boolean;
	readonly currentQuestionIndex?: number;
	readonly questionProgress?: readonly ActivityEntryQuestionProgress[];
	readonly currentQuestionOptions?: readonly ActivityEntryQuestionOption[];
}

const mockQueueGroups = [
	{
		id: "answer_needed",
		label: "Needs answer",
		items: [
			{
				mode: "build",
				title: "Fix auth middleware",
				timeAgo: null,
				insertions: 0,
				deletions: 0,
				isStreaming: false,
				fileToolDisplayText: null,
				statusText: null,
				currentQuestion: {
					question: "Which auth strategy should I use?",
					multiSelect: false,
					options: [{ label: "JWT tokens" }, { label: "Session cookies" }, { label: "OAuth 2.0" }],
				},
				totalQuestions: 1,
				hasMultipleQuestions: false,
				currentQuestionIndex: 0,
				questionProgress: [{ questionIndex: 0, answered: false }],
				currentQuestionOptions: [
					{ label: "JWT tokens", selected: false, color: "#15DB95" },
					{ label: "Session cookies", selected: false, color: "#FF5D5A" },
					{ label: "OAuth 2.0", selected: false, color: "#FF78F7" },
				],
			},
		],
	},
	{
		id: "working",
		label: "Working",
		items: [
			{
				mode: "build",
				title: "Database migration",
				timeAgo: null,
				insertions: 0,
				deletions: 0,
				isStreaming: true,
				fileToolDisplayText: "db/migrate/add_users.sql",
				statusText: null,
				showToolShimmer: true,
				todoProgress: { current: 2, total: 5, label: "migrations" },
			},
		],
	},
	{
		id: "idle",
		label: "Needs Review",
		items: [
			{
				mode: "plan",
				title: "Write API docs",
				timeAgo: null,
				insertions: 0,
				deletions: 0,
				isStreaming: false,
				fileToolDisplayText: null,
				statusText: null,
				todoProgress: { current: 3, total: 3, label: "sections" },
			},
		],
	},
];

const sqlColumns = ["id", "email", "role", "created_at", "active"] as const;
const sqlRows = [
	{
		originalIndex: 0,
		cells: ["1", "alice@dev.io", "admin", "2024-03-15", "true"],
	},
	{
		originalIndex: 1,
		cells: ["2", "bob@team.co", "editor", "2024-03-16", "true"],
	},
	{
		originalIndex: 2,
		cells: ["3", "carol@ops.net", "viewer", "2024-03-17", "false"],
	},
];
const sqlIsCellDirty = (_rowIndex: number, _columnName: string) => false;
const sqlGetCellValue = (rowIndex: number, columnName: string) => {
	const colIdx = sqlColumns.indexOf(columnName as (typeof sqlColumns)[number]);
	return sqlRows[rowIndex]?.cells[colIdx] ?? "";
};
const sqlNoOp = () => {};
const sqlNoOpCell = (_row: number, _col: string) => {};

const features = [
	{
		id: "multi-agent",
		icon: Stack,
		label: m.feature_multi_agent_title(),
		tag: "core",
		description: m.feature_multi_agent_description(),
		usecases: [
			m.feature_multi_agent_usecase_1(),
			m.feature_multi_agent_usecase_2(),
			m.feature_multi_agent_usecase_3(),
		],
	},
	{
		id: "parallel",
		icon: ArrowsOutSimple,
		label: m.feature_parallel_focus_title(),
		tag: "workflow",
		description: m.feature_parallel_focus_description(),
		usecases: [
			m.feature_parallel_focus_usecase_1(),
			m.feature_parallel_focus_usecase_2(),
			m.feature_parallel_focus_usecase_3(),
		],
	},
	{
		id: "plan-mode",
		icon: Lightning,
		label: m.feature_plan_mode_title(),
		tag: "planning",
		description: m.feature_plan_mode_description(),
		usecases: [
			m.feature_plan_mode_usecase_1(),
			m.feature_plan_mode_usecase_2(),
			m.feature_plan_mode_usecase_3(),
		],
	},
	{
		id: "checkpoints",
		icon: GitBranch,
		label: m.feature_checkpoints_title(),
		tag: "safety",
		description: m.feature_checkpoints_description(),
		usecases: [
			m.feature_checkpoints_usecase_1(),
			m.feature_checkpoints_usecase_2(),
			m.feature_checkpoints_usecase_3(),
		],
	},
	{
		id: "sessions",
		icon: ClockCounterClockwise,
		label: m.feature_sessions_title(),
		tag: "history",
		description: m.feature_sessions_description(),
		usecases: [
			m.feature_sessions_usecase_1(),
			m.feature_sessions_usecase_2(),
			m.feature_sessions_usecase_3(),
		],
	},
	{
		id: "keyboard",
		icon: Command,
		label: m.feature_keyboard_title(),
		tag: "input",
		description: m.feature_keyboard_description(),
		usecases: [
			m.feature_keyboard_usecase_1(),
			m.feature_keyboard_usecase_2(),
			m.feature_keyboard_usecase_3(),
		],
	},
	{
		id: "sql-studio",
		icon: HardDrives,
		label: m.feature_sql_studio_title(),
		tag: "data",
		description: m.feature_sql_studio_description(),
		usecases: [
			m.feature_sql_studio_usecase_1(),
			m.feature_sql_studio_usecase_2(),
			m.feature_sql_studio_usecase_3(),
		],
	},
	{
		id: "queue",
		icon: Queue,
		label: m.feature_queue_title(),
		tag: "triage",
		description: m.feature_queue_description(),
		usecases: [
			m.feature_queue_usecase_1(),
			m.feature_queue_usecase_2(),
			m.feature_queue_usecase_3(),
		],
	},
];
</script>

<svelte:head>
	<title>{m.landing_hero_title()} - Acepe</title>
	<meta name="description" content={m.landing_hero_subtitle()} />
</svelte:head>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="pt-20">
		<!-- Hero Section -->
		<section class="flex justify-center px-4 pt-16 pb-12 md:px-6 md:pt-24 md:pb-16">
			<div class="text-center">
				<AgentIconsRow size={24} class="mb-6" />

				<h1 class="mb-6 text-3xl leading-[1.1] font-semibold tracking-[-0.03em] md:text-[56px]">
					{m.landing_hero_title()}
				</h1>
				<p class="mx-auto mb-10 max-w-[760px] text-lg leading-[1.5] font-normal tracking-[-0.01em] text-muted-foreground md:text-[22px]">
					{m.landing_hero_subtitle()}
				</p>

				<div class="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
					<PillButton
						href="/download"
						variant="invert"
						size="default"
						class="h-11 py-1.5 pr-1.5 pl-5"
					>
						{m.landing_hero_cta()}
						{#snippet trailingIcon()}
							<ArrowRightIcon size="lg" />
						{/snippet}
					</PillButton>
				</div>
			</div>
		</section>

		<!-- Feature Showcase Section -->
		<section class="mx-auto max-w-[86rem] px-4 pb-24 md:px-6 md:pb-32">
			<FeatureShowcase />
		</section>

		<!-- What is an ADE? -->
		<section class="border-t border-border/50 px-4 py-24 md:px-6 md:py-32">
			<div class="mx-auto max-w-4xl">
				<div class="mb-16 flex flex-col items-center text-center">
					<div class="mb-5 flex items-center gap-2">
						<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
						<span class="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">The new paradigm</span>
					</div>
					<h2 class="mb-6 text-2xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[40px]">
						{m.landing_ade_title()}
					</h2>
					<p class="max-w-[640px] text-[15px] leading-[1.7] text-muted-foreground md:text-[17px]">
						{m.landing_ade_description()}
					</p>
				</div>

				<!-- Three pillars -->
				<div class="grid gap-6 md:grid-cols-3 md:gap-8">
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{m.landing_pillar_orchestrate_label()}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{m.landing_pillar_orchestrate_title()}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{m.landing_pillar_orchestrate_description()}
						</p>
					</div>
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{m.landing_pillar_observe_label()}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{m.landing_pillar_observe_title()}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{m.landing_pillar_observe_description()}
						</p>
					</div>
					<div class="feature-card rounded-xl border border-border/50 bg-card/20 p-6">
						<div class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
							{m.landing_pillar_control_label()}
						</div>
						<h3 class="mb-2 text-sm font-semibold">{m.landing_pillar_control_title()}</h3>
						<p class="text-[13px] leading-relaxed text-muted-foreground">
							{m.landing_pillar_control_description()}
						</p>
					</div>
				</div>
			</div>
		</section>

		<!-- Features Section -->
		<section class="border-t border-border/50 px-4 py-24 md:px-6 md:py-32">
			<div class="mx-auto max-w-6xl">
				<div class="mb-16 flex flex-col items-center text-center">
					<div class="mb-5 flex items-center gap-2">
						<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
						<span class="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Features</span>
					</div>
					<h2 class="mb-4 text-3xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[44px]">
						{m.landing_features_heading()}
					</h2>
					<p class="max-w-[600px] text-[15px] leading-[1.7] text-muted-foreground md:text-[17px]">
						{m.landing_features_subheading()}
					</p>
				</div>

				<!-- Feature cards -->
				<div class="flex flex-col gap-4 md:gap-6">
					{#each features as feature, i}
						<div class="feature-card overflow-hidden rounded-xl border border-border/50 bg-card/20">
							<div
								class="flex flex-col md:flex-row"
								class:md:flex-row-reverse={i % 2 === 1}
							>
								<div class="flex flex-1 flex-col justify-center p-6 md:p-8">
									<h3 class="mb-3 text-2xl font-semibold tracking-[-0.02em] md:text-4xl">
										{feature.label}
									</h3>
									<p class="mb-5 text-[13px] leading-relaxed text-muted-foreground md:text-sm">
										{feature.description}
									</p>
									<div class="overflow-hidden rounded-md border border-border bg-[color-mix(in_srgb,var(--input)_30%,transparent)]">
										<table class="w-full border-collapse text-[13px] leading-[1.4]">
											<tbody>
												{#each feature.usecases as usecase, ui}
													<tr class="hover:bg-[color-mix(in_srgb,var(--muted)_15%,transparent)]">
														<td class="w-8 py-[0.4rem] pl-3 pr-0 {ui < feature.usecases.length - 1 ? 'border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)]' : ''}">
															<Check size={12} class="shrink-0 text-foreground/50" />
														</td>
														<td class="py-[0.4rem] pr-3 font-mono text-xs text-foreground {ui < feature.usecases.length - 1 ? 'border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)]' : ''}">
															{usecase}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>

								<div
									class="flex flex-1 items-center justify-center overflow-hidden border-t border-border/30 bg-background/50 p-6 md:border-t-0 md:p-8"
									class:md:border-r={i % 2 === 1}
									class:md:border-l={i % 2 === 0}
									style="border-color: var(--border-color-half, rgba(255,255,255,0.05));"
								>
									<div class="showcase w-full max-w-sm">
										{#if feature.id === "multi-agent"}
											<AgentSelectionGrid agents={mockGridAgents} selectedAgentId="claude-code" />
										{:else if feature.id === "parallel"}
											<div class="space-y-2">
												<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
													<AppTabBar tabs={mockTabs} />
												</div>
												<div class="grid grid-cols-2 gap-1 rounded-lg border border-border/50 bg-card/30 p-2">
													<div class="rounded-md border border-border/30 bg-background/50 p-2">
														<div class="mb-1.5 font-mono text-[9px] text-muted-foreground/60">SESSION 1</div>
														<div class="space-y-1">
															<div class="h-1.5 w-full rounded-full bg-muted-foreground/10"></div>
															<div class="h-1.5 w-3/4 rounded-full bg-muted-foreground/10"></div>
															<div class="h-1.5 w-5/6 rounded-full bg-primary/20"></div>
														</div>
													</div>
													<div class="rounded-md border border-border/30 bg-background/50 p-2">
														<div class="mb-1.5 font-mono text-[9px] text-muted-foreground/60">SESSION 2</div>
														<div class="space-y-1">
															<div class="h-1.5 w-full rounded-full bg-muted-foreground/10"></div>
															<div class="h-1.5 w-2/3 rounded-full bg-success/20"></div>
															<div class="h-1.5 w-4/5 rounded-full bg-muted-foreground/10"></div>
														</div>
													</div>
												</div>
											</div>
										{:else if feature.id === "plan-mode"}
											<div class="plan-showcase">
												<PlanCard content={mockPlanContent} title="Plan" status="interactive" />
											</div>
										{:else if feature.id === "checkpoints"}
											<div class="checkpoint-showcase overflow-hidden rounded-lg border border-border/50">
												<CheckpointTimeline checkpoints={mockCheckpoints} showRevertButtons={false} />
											</div>
										{:else if feature.id === "sessions"}
											<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
												<div class="flex h-7 items-center border-b border-border/50 px-2.5">
													<div class="flex flex-1 items-center gap-2 rounded-md bg-muted/30 px-2 py-0.5">
														<MagnifyingGlass size={10} class="text-muted-foreground/50" />
														<span class="font-mono text-[10px] text-muted-foreground/50">Search sessions...</span>
													</div>
												</div>
												<div class="p-1">
													{#each mockSessions as session}
														<AppSessionItemComponent {session} />
													{/each}
												</div>
											</div>
										{:else if feature.id === "keyboard"}
											<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30 shadow-lg">
												<div class="flex items-center gap-2 border-b border-border/50 px-3 py-2">
													<MagnifyingGlass size={12} class="text-muted-foreground/50" />
													<span class="font-mono text-[11px] text-muted-foreground/50">Type a command...</span>
												</div>
												{#each [{ label: "New Session", kbd: "\u2318N" }, { label: "Switch Agent", kbd: "\u2318L" }, { label: "Change Model", kbd: "\u2318/" }, { label: "Command Palette", kbd: "\u2318K" }, { label: "Toggle Sidebar", kbd: "\u2318B" }] as cmd}
													<div class="flex items-center justify-between px-3 py-1.5 first:bg-muted/30">
														<span class="font-mono text-[11px] text-foreground">{cmd.label}</span>
														<kbd class="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{cmd.kbd}</kbd>
													</div>
												{/each}
											</div>
										{:else if feature.id === "sql-studio"}
											<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
												<div class="flex h-7 items-center gap-2 border-b border-border/50 px-2.5">
													<HardDrives size={10} class="text-muted-foreground/60" />
													<span class="font-mono text-[10px] text-foreground">users</span>
													<span class="ml-auto font-mono text-[9px] text-muted-foreground/40">PostgreSQL</span>
												</div>
												<SqlStudioDataGrid
													columns={sqlColumns}
													rows={sqlRows}
													sortColumn={null}
													sortDirection="asc"
													readOnly={true}
													isCellDirty={sqlIsCellDirty}
													getCellValue={sqlGetCellValue}
													onSortChange={sqlNoOp}
													onCellClick={sqlNoOpCell}
												/>
												<div class="flex items-center justify-between border-t border-border/30 px-2.5 py-1">
													<span class="font-mono text-[9px] text-muted-foreground/40">3 rows</span>
												</div>
											</div>
										{:else if feature.id === "queue"}
											<div class="queue-showcase">
											<SectionedFeed
												totalCount={3}
												groups={mockQueueGroups as readonly SectionedFeedGroup<SectionedFeedItemData>[]}
											>
												{#snippet itemRenderer(item: SectionedFeedItemData)}
													{@const entry = item as MockQueueItem}
													<ActivityEntry
														onSelect={() => {}}
														mode={entry.mode}
														title={entry.title}
														timeAgo={entry.timeAgo}
														insertions={entry.insertions}
														deletions={entry.deletions}
														isStreaming={entry.isStreaming}
														taskDescription={null}
														taskSubagentSummaries={[]}
														showTaskSubagentList={false}
														fileToolDisplayText={entry.fileToolDisplayText}
														toolContent={null}
														showToolShimmer={entry.showToolShimmer ?? false}
														statusText={entry.statusText}
														showStatusShimmer={false}
														todoProgress={entry.todoProgress ?? null}
														currentQuestion={entry.currentQuestion ?? null}
														totalQuestions={entry.totalQuestions ?? 0}
														hasMultipleQuestions={entry.hasMultipleQuestions ?? false}
														currentQuestionIndex={entry.currentQuestionIndex ?? 0}
														questionId=""
														questionProgress={entry.questionProgress ?? []}
														currentQuestionAnswered={false}
														currentAnswerDisplay=""
														currentQuestionOptions={entry.currentQuestionOptions ?? []}
														otherText=""
														otherPlaceholder=""
														showOtherInput={false}
														showSubmitButton={false}
														canSubmit={false}
														submitLabel=""
														onOptionSelect={() => {}}
														onOtherInput={() => {}}
														onOtherKeydown={() => {}}
														onSubmitAll={() => {}}
														onPrevQuestion={() => {}}
														onNextQuestion={() => {}}
													/>
												{/snippet}
											</SectionedFeed>
											</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- Bottom CTA -->
		<section class="border-t border-border/50 px-4 py-24 md:px-6">
			<div class="mx-auto flex max-w-2xl flex-col items-center text-center">
				<h2 class="mb-4 text-2xl leading-[1.2] font-semibold tracking-[-0.03em] md:text-[36px]">
					{m.landing_cta_title()}
				</h2>
				<p class="mb-8 max-w-[500px] whitespace-pre-line text-[15px] leading-[1.7] text-muted-foreground md:text-[17px]">
					{m.landing_cta_description()}
				</p>
				<PillButton
					href="/download"
					variant="invert"
					size="default"
					class="h-11 py-1.5 pr-1.5 pl-5"
				>
					{m.landing_hero_cta()}
					{#snippet trailingIcon()}
						<ArrowRightIcon size="lg" />
					{/snippet}
				</PillButton>
				<a
					href="/compare/cursor"
					class="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					{m.landing_cta_compare()}
				</a>
			</div>
		</section>
	</main>

	<!-- Footer -->
	<footer class="border-t border-border/50 px-4 py-12 md:px-6">
		<div class="mx-auto max-w-6xl">
			<div class="grid grid-cols-2 gap-8 md:grid-cols-4">
				<!-- Brand -->
				<div class="col-span-2 md:col-span-1">
					<a href="/" class="mb-3 inline-flex items-center gap-2">
						<BrandLockup class="gap-2" markClass="h-6 w-6" wordmarkClass="text-sm" />
					</a>
					<p class="max-w-[200px] text-[13px] leading-relaxed text-muted-foreground">
						{m.landing_hero_title()}
					</p>
				</div>

				<!-- Product -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_product()}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/blog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_blog()}
							</a>
						</li>
						<li>
							<a href="/changelog" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.changelog_nav_label()}
							</a>
						</li>
						<li>
							<a href="/pricing" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_pricing()}
							</a>
						</li>
						<li>
							<a href="/compare" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.nav_compare()}
							</a>
						</li>
						{#if data.featureFlags?.roadmapEnabled}
							<li>
								<a href="/roadmap" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
									{m.nav_roadmap()}
								</a>
							</li>
						{/if}
					</ul>
				</div>

				<!-- Resources -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_resources()}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a
								href="https://github.com/flazouh/acepe"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
							>
								<GithubLogo size={14} weight="fill" />
								GitHub
							</a>
						</li>
					</ul>
				</div>

				<!-- Legal -->
				<div>
					<h3 class="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
						{m.footer_legal()}
					</h3>
					<ul class="flex flex-col gap-2">
						<li>
							<a href="/privacy" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.footer_privacy()}
							</a>
						</li>
						<li>
							<a href="/terms" class="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
								{m.footer_terms()}
							</a>
						</li>
					</ul>
				</div>
			</div>

			<!-- Bottom bar -->
			<div class="mt-10 border-t border-border/30 pt-6">
				<span class="font-mono text-[11px] text-muted-foreground/50">
					{m.footer_copyright({ year: new Date().getFullYear().toString() })}
				</span>
			</div>
		</div>
	</footer>
</div>

<style>
	.feature-card {
		backdrop-filter: blur(12px);
	}

	.showcase {
		pointer-events: none;
		user-select: none;
	}

	.plan-showcase,
	.checkpoint-showcase {
		transform: scale(0.92);
		transform-origin: center center;
	}

	.queue-showcase {
		width: 70%;
		margin: 0 auto;
	}

	/* Equalize top/bottom padding inside checkpoint file lists */
	.checkpoint-showcase :global(.px-2.py-1) {
		padding-top: 0.125rem;
		padding-bottom: 0.125rem;
	}

	/* Indent question options in the queue showcase */
	.showcase :global(.pl-2\.5.rounded-sm) {
		margin-left: 2px;
		margin-bottom: 1px;
	}

	/* Bottom margin on last option */
	.queue-showcase :global(.pl-2\.5.rounded-sm:last-child) {
		margin-bottom: 4px;
	}

	.showcase :global(button),
	.showcase :global(a),
	.showcase :global(input),
	.showcase :global(textarea) {
		pointer-events: none !important;
		cursor: default !important;
	}
</style>
