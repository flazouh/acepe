<script lang="ts">
	import { CheckCircle, CircleDashed, XCircle } from "phosphor-svelte";

	import { FilePathBadge } from "../file-path-badge/index.js";
	import type { AgentPanelFileReviewStatus } from "./types.js";

	interface ReviewTab {
		id: string;
		filePath: string;
		fileName?: string | null;
		linesAdded: number;
		linesRemoved: number;
		status: AgentPanelFileReviewStatus;
	}

	interface Props {
		tabs: readonly ReviewTab[];
		selectedIndex: number;
		onSelectTab: (index: number) => void;
		acceptedTooltip?: string;
		partialTooltip?: string;
		deniedTooltip?: string;
	}

	let {
		tabs,
		selectedIndex,
		onSelectTab,
		acceptedTooltip = "All changes accepted",
		partialTooltip = "Partially reviewed",
		deniedTooltip = "Changes rejected",
	}: Props = $props();

	function getStatusTooltip(status: ReviewTabStatus): string {
		if (status === "accepted") return acceptedTooltip;
		if (status === "denied") return deniedTooltip;
		return partialTooltip;
	}
</script>

<div class="flex overflow-x-auto min-w-0 shrink-0 scrollbar-thin" role="tablist">
	{#each tabs as tab, index (tab.id)}
		<button
			type="button"
			role="tab"
			aria-selected={selectedIndex === index}
			aria-label="{tab.fileName ?? tab.filePath} - {getStatusTooltip(tab.status)}"
			class="review-tab inline-flex h-8 items-center gap-1.5 shrink-0 px-2 text-xs border-r border-border last:border-r-0 transition-colors {selectedIndex === index
				? 'bg-accent/25 text-foreground'
				: 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'}"
			onclick={() => onSelectTab(index)}
		>
			<span class="flex items-center gap-1.5 min-w-0" title={getStatusTooltip(tab.status)}>
				{#if tab.status === "accepted"}
					<CheckCircle class="h-3.5 w-3.5 shrink-0 text-success" weight="fill" />
				{:else if tab.status === "denied"}
					<XCircle class="h-3.5 w-3.5 shrink-0 text-destructive" weight="fill" />
				{:else}
					<CircleDashed class="h-3.5 w-3.5 shrink-0 text-primary" weight="bold" />
				{/if}
				<span class="review-tab-chip contents">
					<FilePathBadge
						filePath={tab.filePath}
						fileName={tab.fileName}
						linesAdded={tab.linesAdded}
						linesRemoved={tab.linesRemoved}
						selected={selectedIndex === index}
						interactive={false}
					/>
				</span>
			</span>
		</button>
	{/each}
</div>

<style>
	.review-tab :global(.file-path-badge),
	.review-tab :global(.file-path-badge:hover),
	.review-tab :global(.file-path-badge-selected) {
		background: transparent !important;
	}
</style>
