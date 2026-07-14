<script lang="ts">
	import {
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";

	type QuestionHeaderState = "answered" | "cancelled" | "interactive";

	interface Props {
		state: QuestionHeaderState;
		title: string;
		badge?: string | null;
		durationTiming?: ToolDurationTiming;
	}

	let { state, title, badge = null, durationTiming }: Props = $props();
</script>

<EmbeddedPanelHeader class="bg-accent/40">
	<HeaderTitleCell compactPadding>
		{#if state === "cancelled"}
			<HugeiconsIcon name="x-circle" class="size-3.5 shrink-0 mr-1 text-muted-foreground" />
		{:else if state === "answered"}
			<HugeiconsIcon name="question-circle" class="h-3.5 w-3.5 shrink-0 mr-1 text-success" />
		{:else}
			<HugeiconsIcon name="question-circle" class="h-3.5 w-3.5 shrink-0 mr-1 text-primary" />
		{/if}
		<span class="question-title">{title}</span>
		{#if badge}
			<span class="question-badge ml-1.5">{badge}</span>
		{/if}
	</HeaderTitleCell>
	{#if durationTiming}
		<HeaderActionCell>
			<span class="inline-flex items-center px-2 text-sm">
				<AgentToolDurationLabel timing={durationTiming} class="text-sm" />
			</span>
		</HeaderActionCell>
	{/if}
</EmbeddedPanelHeader>

<style>
	.question-title {
		font-size: 0.875rem;
		user-select: none;
	}

	.question-badge {
		font-size: 0.875rem;
		padding: 1px 6px;
		border-radius: 0.25rem;
		background: var(--muted);
	}
</style>
