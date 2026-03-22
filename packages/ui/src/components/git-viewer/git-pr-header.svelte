<script lang="ts">
	import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
	import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import GitMerge from "phosphor-svelte/lib/GitMerge";

	import { DiffPill } from "../diff-pill/index.js";
	import { cn } from "../../lib/utils.js";
	import type { GitPrData } from "./types.js";

	interface Props {
		pr: GitPrData;
		class?: string;
		onViewOnGitHub?: () => void;
	}

	let { pr, class: className, onViewOnGitHub }: Props = $props();

	let expanded = $state(false);

	const totalInsertions = $derived(
		pr.files.reduce((sum, f) => sum + f.additions, 0)
	);
	const totalDeletions = $derived(
		pr.files.reduce((sum, f) => sum + f.deletions, 0)
	);

	const stateConfig = $derived.by(() => {
		switch (pr.state) {
			case "open":
				return { label: "Open", class: "bg-success/15 text-success" };
			case "merged":
				return { label: "Merged", class: "bg-[#a371f7]/15 text-[#a371f7]" };
			case "closed":
				return { label: "Closed", class: "bg-destructive/15 text-destructive" };
		}
	});

	const PrIcon = $derived(pr.state === "merged" ? GitMerge : GitPullRequest);
	const iconColor = $derived(
		pr.state === "merged" ? "text-[#a371f7]" :
		pr.state === "open" ? "text-success" :
		"text-destructive"
	);
</script>

<div class={cn("rounded-lg border border-border/50 bg-card overflow-hidden", className)}>
	<!-- Primary row: icon + PR# + title + state + diff pill + actions -->
	<div class="flex items-center gap-2 px-3 py-2">
		<span class="shrink-0 {iconColor}">
			<PrIcon weight="bold" size={16} />
		</span>

		<span class="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
			#{pr.number}
		</span>

		<span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
			{pr.title}
		</span>

		<span class="shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold {stateConfig.class}">
			{stateConfig.label}
		</span>

		{#if totalInsertions > 0 || totalDeletions > 0}
			<DiffPill insertions={totalInsertions} deletions={totalDeletions} variant="plain" />
		{/if}

		{#if pr.githubUrl && onViewOnGitHub}
			<button
				type="button"
				class="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] text-muted-foreground transition-colors hover:text-foreground hover:bg-muted cursor-pointer"
				onclick={onViewOnGitHub}
				title="View on GitHub"
			>
				<ArrowSquareOut size={12} />
			</button>
		{/if}

		<button
			type="button"
			class="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground transition-all hover:text-foreground hover:bg-muted cursor-pointer"
			onclick={() => { expanded = !expanded; }}
			title={expanded ? "Collapse details" : "Expand details"}
		>
			<CaretDown
				size={12}
				weight="bold"
				class="transition-transform duration-150 {expanded ? 'rotate-180' : ''}"
			/>
		</button>
	</div>

	<!-- Expandable details -->
	{#if expanded}
		<div class="border-t border-border/30 px-3 py-2 space-y-1.5">
			{#if pr.description}
				<p class="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-4">
					{pr.description}
				</p>
			{/if}
			<div class="flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
				<span>{pr.author}</span>
				<span class="text-border">|</span>
				<span class="font-mono">{pr.files.length} {pr.files.length === 1 ? "file" : "files"}</span>
			</div>
		</div>
	{/if}
</div>
