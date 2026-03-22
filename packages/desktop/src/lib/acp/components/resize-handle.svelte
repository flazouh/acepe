<script lang="ts">
interface Props {
	onResize: (delta: number) => void;
}

let { onResize }: Props = $props();

let dragging = $state(false);
let startX = 0;

function handlePointerDown(e: PointerEvent) {
	dragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!dragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(delta);
}

function handlePointerUp() {
	dragging = false;
}
</script>

<div
	role="separator"
	aria-orientation="vertical"
	class="group relative h-full w-3 shrink-0 cursor-col-resize"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
>
	<div
		class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px group-hover:w-[3px] bg-border group-hover:bg-primary/50 transition-all {dragging
			? 'w-[3px] bg-primary/50'
			: ''}"
	></div>
</div>
