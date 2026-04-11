<!--
  AgentInputSelectorCheck - Check icon shown next to selected dropdown items.

  Extracted from packages/desktop/src/lib/acp/components/selector-check.svelte.
-->
<script lang="ts">
	import { IconCheck } from "@tabler/icons-svelte";

	interface Props {
		visible: boolean;
	}

	let { visible }: Props = $props();
</script>

{#if visible}
	<IconCheck class="h-4 w-4 shrink-0 text-foreground" />
{/if}
