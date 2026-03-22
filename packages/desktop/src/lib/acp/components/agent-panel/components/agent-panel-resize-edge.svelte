<script lang="ts">
import type { AgentPanelResizeEdgeProps } from "../types/agent-panel-resize-edge-props.js";

let { isDragging, onPointerDown, onPointerMove, onPointerUp }: AgentPanelResizeEdgeProps = $props();
</script>

<!-- Wider invisible hit target; 1px line idle, 3px on hover/drag only (avoids stacking with panel border-r) -->
<div
	class="absolute top-0 right-0 z-10 flex h-full w-3 cursor-col-resize justify-end touch-none"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
>
	<div
		class="h-full shrink-0 bg-border transition-[width] duration-150 ease-out hover:bg-primary/50 {isDragging
			? 'w-[3px] bg-primary/50'
			: 'w-px hover:w-[3px]'}"
		aria-hidden="true"
	></div>
</div>
