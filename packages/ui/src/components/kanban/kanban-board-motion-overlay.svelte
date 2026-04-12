<script lang="ts">
	import type { Snippet } from "svelte";

	import type { KanbanSceneCardData } from "./kanban-scene-types.js";
	import type { KanbanBoardMotionOverlay } from "./kanban-board-motion.js";

	interface Props {
		overlays: readonly KanbanBoardMotionOverlay[];
		ghostRenderer?: Snippet<[KanbanSceneCardData]>;
	}

	let { overlays, ghostRenderer }: Props = $props();

	function buildOverlayStyle(overlay: KanbanBoardMotionOverlay): string {
		const rect = overlay.phase === "start" ? overlay.originRect : overlay.destinationRect;
		const opacity = overlay.phase === "start" ? 0.9 : 0;
		return `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;opacity:${opacity};transition-duration:${overlay.durationMs}ms;`;
	}
</script>

<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
	{#each overlays as overlay (overlay.cardId)}
		<div
			class="absolute overflow-hidden rounded-lg transition-[left,top,width,height,opacity] ease-out"
			data-motion-mode={overlay.mode}
			style={buildOverlayStyle(overlay)}
		>
			{#if ghostRenderer}
				{@render ghostRenderer(overlay.card)}
			{:else}
				<div class="flex h-full w-full flex-col justify-between rounded-lg border border-border/60 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-[2px]">
					<div class="truncate text-sm font-medium text-foreground">
						{overlay.card.title ? overlay.card.title : overlay.card.agentLabel}
					</div>
					<div class="truncate text-[11px] text-muted-foreground">{overlay.card.projectName}</div>
				</div>
			{/if}
		</div>
	{/each}
</div>
