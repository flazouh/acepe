<!--
  AgentInputToolbar - Horizontal toolbar shell below the composer editor.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte.
  Accepts left items and trailing controls as snippet slots.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		hidden?: boolean;
		/** Left-side toolbar items: mode selector, model selector, autonomous toggle, etc. */
		items?: Snippet;
		/** Right-side trailing controls: metrics chip, mic button, checkpoint button, etc. */
		trailing?: Snippet;
	}

	let { hidden = false, items, trailing }: Props = $props();
</script>

<div
	class="flex items-center h-7 w-full transition-opacity duration-200 ease-out"
	class:opacity-0={hidden}
	class:pointer-events-none={hidden}
>
	{#if items}
		<div class="flex items-center h-full min-w-0">
			{@render items()}
		</div>
	{/if}

	{#if trailing}
		<div class="flex items-center h-7 ml-auto">
			{@render trailing()}
		</div>
	{/if}
</div>
