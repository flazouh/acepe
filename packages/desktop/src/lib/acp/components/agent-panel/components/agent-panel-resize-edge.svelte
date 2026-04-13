<script lang="ts">
import type { AgentPanelResizeEdgeProps } from "../types/agent-panel-resize-edge-props.js";

let { isDragging, onPointerDown, onPointerMove, onPointerUp }: AgentPanelResizeEdgeProps = $props();
</script>

<!-- Wider invisible hit target, inset to avoid overlapping header/footer controls. -->
<div
	class="absolute top-7 bottom-7 right-0 z-10 flex w-3 cursor-col-resize justify-end touch-none"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
>
	<div
		class="h-full shrink-0 bg-transparent transition-[width] duration-150 ease-out hover:bg-primary/50 {isDragging
			? 'w-[3px] bg-primary/50'
			: 'w-px hover:w-[3px]'}"
		aria-hidden="true"
	></div>
</div>
