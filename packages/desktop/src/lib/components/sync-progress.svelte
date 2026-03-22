<script lang="ts">
import { Progress } from "$lib/components/ui/progress/index.js";
import { cn } from "$lib/utils.js";

interface Props {
	processed: number;
	total: number;
	created: number;
	updated: number;
	class?: string;
}

let { processed, total, created, updated, class: className }: Props = $props();

const percentage = $derived(total > 0 ? (processed / total) * 100 : 0);
</script>

<div
	class={cn(
		"fixed top-0 left-0 right-0 z-50 bg-background/95 border-b border-border shadow-lg",
		className
	)}
>
	<div class="container mx-auto px-4 py-3">
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-2">
				<div class="text-sm font-medium text-foreground">Syncing conversations...</div>
				<div class="text-xs text-muted-foreground">
					{processed} / {total}
				</div>
			</div>
			<div class="text-xs text-muted-foreground">
				{#if created > 0 || updated > 0}
					{created} new, {updated} updated
				{/if}
			</div>
		</div>
		<Progress value={percentage} max={100} class="h-1.5" />
	</div>
</div>
