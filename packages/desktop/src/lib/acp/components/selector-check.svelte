<script lang="ts">
import IconCheck from "@tabler/icons-svelte/icons/check";

interface Props {
	visible: boolean;
}

const { visible }: Props = $props();
</script>

{#if visible}
	<IconCheck class="h-4 w-4 shrink-0 text-foreground" />
{/if}
