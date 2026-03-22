<script lang="ts">
	/**
	 * GitBranchBadge — Branch name badge with git branch icon.
	 */
	import GitBranch from "phosphor-svelte/lib/GitBranch";

	import { cn } from "../../lib/utils.js";

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
		"inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] font-medium",
		"bg-muted/50 text-foreground hover:bg-muted/80 transition-colors",
		onclick ? "cursor-pointer" : "cursor-default",
		className,
	)}
	{onclick}
>
	<GitBranch size={14} weight="bold" class="text-muted-foreground shrink-0" />
	<span class="truncate max-w-[160px] font-mono">{branch}</span>
</button>
