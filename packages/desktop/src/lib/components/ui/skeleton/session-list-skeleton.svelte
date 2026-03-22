<script lang="ts">
import { Skeleton } from "$lib/components/ui/skeleton/index.js";

interface Props {
	/** Number of session item skeletons to show (default: 3) */
	sessionCount?: number;
}

let { sessionCount = 3 }: Props = $props();
</script>

<!-- Session items skeleton - matches session-item layout (no list padding, no dividers) -->
<div
	class="flex flex-col min-h-0 min-w-0 overflow-hidden p-0"
	data-slot="session-list-skeleton"
>
	{#each Array.from({ length: sessionCount }, (_, i) => i) as index (index)}
		<div class="px-2 py-2 flex flex-col gap-1 min-w-0">
			<!-- Top row: title (flex-1 min-w-0 so it shrinks) -->
			<div class="flex items-start gap-2 min-w-0">
				<div class="flex-1 min-w-0 overflow-hidden">
					<Skeleton class="h-3.5 max-w-full rounded" style="width: 75%;" />
				</div>
				<!-- Menu button placeholder -->
				<Skeleton class="h-4 w-4 shrink-0 rounded" />
			</div>
			<!-- Bottom row: timestamp + agent icon -->
			<div class="flex items-center justify-between gap-1">
				<Skeleton class="h-2.5 w-12 shrink-0 rounded" />
				<Skeleton class="h-3 w-3 shrink-0 rounded" />
			</div>
		</div>
	{/each}
</div>
