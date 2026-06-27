<script lang="ts">
	import type { Snippet } from "svelte";
	import { GitPullRequest } from "../icons/index.js";

	import { Button } from "../button/index.js";
	import * as ButtonGroup from "../button-group/index.js";
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

<ButtonGroup.Root
	class="shrink-0 text-[0.6875rem]"
	aria-label="Create pull request"
	onclick={(event: MouseEvent) => event.stopPropagation()}
>
	<Button
		variant="headerAction"
		size="headerAction"
		class="group/open-pr"
		disabled={loading || disabled}
		{onclick}
	>
		<span class="flex shrink-0 items-center gap-1">
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
</ButtonGroup.Root>
