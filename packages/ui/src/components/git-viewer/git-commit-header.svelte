<script lang="ts">
	import GitCommit from "phosphor-svelte/lib/GitCommit";
	import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import Copy from "phosphor-svelte/lib/Copy";
	import Check from "phosphor-svelte/lib/Check";

	import { DiffPill } from "../diff-pill/index.js";
	import { cn } from "../../lib/utils.js";
	import type { GitCommitData } from "./types.js";

	interface Props {
		commit: GitCommitData;
		class?: string;
		onViewOnGitHub?: () => void;
	}

	let { commit, class: className, onViewOnGitHub }: Props = $props();

	let expanded = $state(false);
	let copied = $state(false);

	const totalInsertions = $derived(
		commit.files.reduce((sum, f) => sum + f.additions, 0)
	);
	const totalDeletions = $derived(
		commit.files.reduce((sum, f) => sum + f.deletions, 0)
	);

	function copysha() {
		navigator.clipboard.writeText(commit.sha);
		copied = true;
		setTimeout(() => { copied = false; }, 1500);
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}
</script>

<div class={cn("rounded-lg border border-border/50 bg-card overflow-hidden", className)}>
	<!-- Primary row: icon + SHA + message + diff pill + actions -->
	<div class="flex items-center gap-2 px-3 py-2">
		<span class="shrink-0 text-success">
			<GitCommit weight="bold" size={16} />
		</span>

		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
			title="Copy full SHA"
			onclick={copysha}
		>
			{commit.shortSha}
			{#if copied}
				<Check size={10} weight="bold" />
			{:else}
				<Copy size={10} />
			{/if}
		</button>

		<span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
			{commit.message}
		</span>

		{#if totalInsertions > 0 || totalDeletions > 0}
			<DiffPill insertions={totalInsertions} deletions={totalDeletions} variant="plain" />
		{/if}

		{#if commit.githubUrl && onViewOnGitHub}
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
			{#if commit.messageBody}
				<p class="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
					{commit.messageBody}
				</p>
			{/if}
			<div class="flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
				<span>{commit.author}</span>
				<span class="text-border">|</span>
				<span>{formatDate(commit.date)}</span>
				<span class="text-border">|</span>
				<span class="font-mono">{commit.files.length} {commit.files.length === 1 ? "file" : "files"}</span>
			</div>
		</div>
	{/if}
</div>
