<script lang="ts">
import {
	BellRinging,
	ClockCounterClockwise,
	Database,
	GitBranch,
	PencilRuler,
	Terminal,
} from "phosphor-svelte";
import Card from "./ui/card/card.svelte";
import AgentPanelDemo from "./agent-panel-demo.svelte";
import CheckpointDemo from "./checkpoint-demo.svelte";
import GitViewerDemo from "./git-viewer-demo.svelte";
import PlanDemo from "./plan-demo.svelte";
import QueueDemo from "./queue-demo.svelte";
import SqlFeaturesDemo from "./sql-features-demo.svelte";

type FeatureTab = "agent" | "plan" | "queue" | "git" | "sql" | "checkpoint";

const features = [
	{
		id: "agent" as FeatureTab,
		icon: Terminal,
		tab: "Agent Panel",
		title: "Your AI, beautifully in context",
		description:
			"Watch your agent read files, run tests, write code — every tool call visible inline. No terminal hunting, no black boxes. A live view of exactly what your AI is doing.",
		useCases: [
			"See every file read, written, and tested in real time",
			"Follow multi-step tasks without losing your place",
			"Pick up where the agent left off — full conversation history preserved",
		],
	},
	{
		id: "plan" as FeatureTab,
		icon: PencilRuler,
		tab: "Plan Mode",
		title: "Plan before you build",
		description:
			"Acepe outlines a step-by-step implementation plan before touching any code. Review, adjust, and execute with full visibility into what will change.",
		useCases: [
			"See exactly what will change before it happens",
			"Catch missing edge cases before they become bugs",
			"Keep agents on track across complex multi-step tasks",
		],
	},
	{
		id: "queue" as FeatureTab,
		icon: BellRinging,
		tab: "Attention Queue",
		title: "All your agents, one place",
		description:
			"Run multiple AI agents across different projects simultaneously. The attention queue surfaces only what needs your input — questions, errors, decisions.",
		useCases: [
			"Answer agent questions without losing focus",
			"Monitor parallel sessions from a single panel",
			"See diff stats accumulate as agents work",
		],
	},
	{
		id: "git" as FeatureTab,
		icon: GitBranch,
		tab: "Git Integration",
		title: "Full git workflow, built in",
		description:
			"Stage files, commit, push, and review PRs and commits — all from inside Acepe. Browse file diffs, track what your agent shipped, and manage your branch without leaving context.",
		useCases: [
			"Stage, commit, and push without a terminal",
			"Review PR and commit diffs with file tree navigation",
			"Track remote branch status and history inline",
		],
	},
	{
		id: "sql" as FeatureTab,
		icon: Database,
		tab: "SQL Studio",
		title: "Browse your data inline",
		description:
			"Connect to Postgres, MySQL, or SQLite. Explore schemas, filter rows, edit cells, and run queries — all inline with your coding session.",
		useCases: [
			"Explore schemas, tables, and column definitions",
			"Filter and sort rows to find what you need",
			"Edit cells and run custom SQL queries",
		],
	},
	{
		id: "checkpoint" as FeatureTab,
		icon: ClockCounterClockwise,
		tab: "Checkpoints",
		title: "Undo anything, instantly",
		description:
			"Acepe auto-saves a checkpoint after every agent step. If something goes wrong, revert to any earlier state in one click — no git required.",
		useCases: [
			"Auto-saved at every significant file change",
			"Revert to any earlier checkpoint instantly",
			"Inspect exactly which files changed at each step",
		],
	},
];

let activeTab = $state<FeatureTab>("agent");
const defaultFeature = features[0];
if (!defaultFeature) {
	throw new Error("homepage features must define at least one feature");
}
let activeFeature = $derived(features.find((f) => f.id === activeTab) ?? defaultFeature);
</script>

<section class="mx-auto max-w-6xl px-4 pt-8 pb-32 md:px-6 md:pt-12 md:pb-40">
	<!-- Section heading -->
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-3xl font-semibold tracking-tight md:text-4xl">
			Everything you need to ship with AI
		</h2>
		<p class="text-base text-muted-foreground md:text-lg">
			Built-in tools that keep you in flow — no context switching required.
		</p>
	</div>

	<!-- Tab bar -->
	<div class="mb-8 flex flex-wrap justify-center gap-2">
		{#each features as f}
			<button
				class="inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
				class:bg-foreground={activeTab === f.id}
				class:text-background={activeTab === f.id}
				class:text-muted-foreground={activeTab !== f.id}
				class:hover:text-foreground={activeTab !== f.id}
				onclick={() => (activeTab = f.id)}
			>
				<f.icon size={15} weight="fill" />
				{f.tab}
			</button>
		{/each}
	</div>

	<!-- Feature content -->
	<div class="flex flex-col items-start gap-8 lg:flex-row lg:gap-12">
		<!-- Left: description -->
		<div class="w-full shrink-0 lg:w-72">
			<h3 class="mb-3 text-xl font-semibold">{activeFeature.title}</h3>
			<p class="mb-6 text-sm leading-relaxed text-muted-foreground">{activeFeature.description}</p>
			<ul class="space-y-3">
				{#each activeFeature.useCases as uc}
					<li class="flex items-start gap-3">
						<span
							class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10"
						>
							<span class="h-2 w-2 rounded-full bg-primary"></span>
						</span>
						<span class="text-sm text-foreground">{uc}</span>
					</li>
				{/each}
			</ul>
		</div>

		<!-- Right: live demo -->
		<div class="w-full min-w-0 flex-1">
			<Card class="h-[480px] overflow-hidden p-0">
				{#if activeTab === 'agent'}
					<AgentPanelDemo />
				{:else if activeTab === 'plan'}
					<PlanDemo />
				{:else if activeTab === 'queue'}
					<div class="flex h-full items-start justify-center overflow-y-auto p-6">
						<QueueDemo />
					</div>
				{:else if activeTab === 'git'}
					<GitViewerDemo />
				{:else if activeTab === 'sql'}
					<SqlFeaturesDemo />
				{:else}
					<CheckpointDemo />
				{/if}
			</Card>
		</div>
	</div>
</section>
