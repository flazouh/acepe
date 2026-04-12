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
		const opacity = overlay.phase === "start" ? 1 : 0;
		const easing = "cubic-bezier(0.16,1,0.3,1)";
		const d = overlay.durationMs;
		const fadeDelay = Math.round(d * 0.6);
		const fadeDuration = d - fadeDelay;
		return [
			`left:${rect.left}px`,
			`top:${rect.top}px`,
			`width:${rect.width}px`,
			`height:${rect.height}px`,
			`opacity:${opacity}`,
			`transition:left ${d}ms ${easing},top ${d}ms ${easing},width ${d}ms ${easing},height ${d}ms ${easing},opacity ${fadeDuration}ms ease-out ${fadeDelay}ms`,
		].join(";") + ";";
	}
</script>

<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
	{#each overlays as overlay (overlay.cardId)}
		<div
			class="absolute overflow-hidden rounded-lg"
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
