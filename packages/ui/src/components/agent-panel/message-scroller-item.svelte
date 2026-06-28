<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		rowId: string;
		estimatePx: number;
		isActiveTail: boolean;
		anchorEligible: boolean;
		children: Snippet;
	}

	let { rowId, estimatePx, isActiveTail, anchorEligible, children }: Props = $props();
</script>

<!--
  One transcript row in normal document flow. `content-visibility:auto` lets the
  browser skip layout/paint for off-screen rows (the virtualization replacement);
  `contain-intrinsic-size:auto <est>` reserves plausible space until first paint,
  then remembers the real size. The active streaming tail opts out so it is never
  skipped while it is being announced/updated. `data-anchor` marks rows the JS
  scroll-anchoring may hold stationary (WebKit has no `overflow-anchor`).
-->
<div
	class={["message-scroller-item", isActiveTail && "is-active-tail"]}
	style:--cv-estimate-px="{estimatePx}px"
	data-row-id={rowId}
	data-anchor={anchorEligible ? "" : undefined}
>
	{@render children()}
</div>

<style>
	.message-scroller-item {
		content-visibility: auto;
		contain-intrinsic-size: auto var(--cv-estimate-px);
	}

	.message-scroller-item.is-active-tail {
		content-visibility: visible;
	}
</style>
