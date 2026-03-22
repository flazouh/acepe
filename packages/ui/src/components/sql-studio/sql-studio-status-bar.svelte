<script lang="ts">
	import { cn } from "../../lib/utils.js";

	interface Props {
		rowCount: number;
		hasMore: boolean;
		isLoadingMore: boolean;
		onLoadMore: () => void;
		class?: string;
	}

	let { rowCount, hasMore, isLoadingMore, onLoadMore, class: className }: Props = $props();
</script>

<div class={cn("shrink-0 flex items-center justify-between px-2 py-1 border-t border-border/30", className)}>
	<span class="text-[0.625rem] text-muted-foreground font-mono">
		{rowCount} row{rowCount === 1 ? "" : "s"}
	</span>
	<button
		type="button"
		class="text-[0.6875rem] text-muted-foreground hover:text-foreground hover:bg-muted/50 px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
		onclick={onLoadMore}
		disabled={!hasMore || isLoadingMore}
	>
		{isLoadingMore ? "Loading..." : hasMore ? "Load more" : "End"}
	</button>
</div>
