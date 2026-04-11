<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		columnWidth?: number;
		tabs: Snippet;
		body: Snippet;
	}

	let { children: _children, columnWidth = 450, tabs, body }: Props = $props();
</script>

<div
	class="flex h-full min-h-0 shrink-0 flex-col gap-0 overflow-hidden"
	style={`min-width: ${columnWidth}px; width: ${columnWidth}px; max-width: ${columnWidth}px; flex-basis: ${columnWidth}px;`}
>
	<div class="flex min-h-8 shrink-0 items-center overflow-x-auto border-r border-border bg-muted/20">
		{@render tabs()}
	</div>

	<div class="min-h-0 flex-1 overflow-hidden">
		{@render body()}
	</div>
</div>
