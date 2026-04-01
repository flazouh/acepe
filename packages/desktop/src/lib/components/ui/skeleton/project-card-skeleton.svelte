<script lang="ts">
import { Skeleton } from "$lib/components/ui/skeleton/index.js";

import SessionListSkeleton from "./session-list-skeleton.svelte";

interface Props {
	/** Number of session item skeletons to show (default: 3) */
	sessionCount?: number;
	/** Whether to show sessions below header (collapsed = header only) (default: true) */
	isExpanded?: boolean;
}

let { sessionCount = 3, isExpanded = true }: Props = $props();
</script>

<div
	class="flex flex-col overflow-hidden border border-border bg-card/50 min-w-0"
	data-slot="project-card-skeleton"
>
	<!-- Project header skeleton - matches ProjectHeader (name truncates in real UI) -->
	<div class="rounded-md flex items-center gap-2 px-2 py-1 shrink-0 min-w-0" aria-hidden="true">
		<!-- Letter badge (ProjectLetterBadge default size 20px) -->
		<Skeleton class="h-4 w-4 shrink-0 rounded" />
		<!-- Project name (flex-1 so it shrinks in narrow sidebar) -->
		<Skeleton class="h-3.5 flex-1 min-w-0 max-w-24 rounded" />
		<!-- Trailing (settings dots) -->
		<Skeleton class="h-6 w-6 shrink-0 rounded-md" />
		<!-- Action buttons: folder, terminal, plus -->
		<div class="flex items-center gap-1 shrink-0">
			<Skeleton class="h-7 w-7 shrink-0 rounded-md" />
			<Skeleton class="h-7 w-7 shrink-0 rounded-md" />
			<Skeleton class="h-7 w-7 shrink-0 rounded-md" />
		</div>
	</div>

	{#if isExpanded}
		<SessionListSkeleton {sessionCount} />
	{/if}
</div>
