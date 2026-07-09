<script lang="ts">
	/**
	 * GitBranchBadge — current branch as a clean, borderless picker control.
	 */
	import { cn } from "../../lib/utils.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		branch: string;
		onclick?: () => void;
		class?: string;
	}

	let { branch, onclick, class: className }: Props = $props();
</script>

<button
	type="button"
	class={cn(
		"inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-foreground transition-colors",
		onclick ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
		className,
	)}
	{onclick}
>
	<RoundedIcon name="branch" class="size-[13px] shrink-0 text-muted-foreground" />
	<span class="max-w-[200px] truncate font-mono">{branch}</span>
	{#if onclick}
		<RoundedIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground/50" />
	{/if}
</button>
