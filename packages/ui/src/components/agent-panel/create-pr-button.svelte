<script lang="ts">
	import type { Snippet } from "svelte";
	import { GitPullRequest } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import { DiffPill } from "../diff-pill/index.js";

	interface Props {
		label?: string;
		loading?: boolean;
		loadingLabel?: string | null;
		insertions?: number;
		deletions?: number;
		disabled?: boolean;
		onclick?: () => void;
		settingsTrigger?: Snippet;
	}

	let {
		label = "Create PR",
		loading = false,
		loadingLabel = null,
		insertions = 0,
		deletions = 0,
		disabled = false,
		onclick,
		settingsTrigger,
	}: Props = $props();
</script>

<div
	class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
	onclick={(e) => e.stopPropagation()}
	role="none"
>
	<Button
		variant="headerAction"
		size="headerAction"
		class="group/open-pr rounded-none border-0 bg-transparent shadow-none"
		disabled={loading || disabled}
		{onclick}
	>
		<span class="flex items-center gap-1 shrink-0">
			<GitPullRequest
				size={11}
				weight="bold"
				class="shrink-0 text-muted-foreground transition-colors group-hover/open-pr:text-success"
			/>
			{loading && loadingLabel ? loadingLabel : label}
		</span>
		<DiffPill {insertions} {deletions} variant="plain" />
	</Button>
	{#if settingsTrigger}
		{@render settingsTrigger()}
	{/if}
</div>
