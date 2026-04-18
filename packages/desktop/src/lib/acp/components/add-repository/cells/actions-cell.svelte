<script lang="ts">
import { Button } from "@acepe/ui/button";
import { CheckCircle } from "phosphor-svelte";
import { DownloadSimple } from "phosphor-svelte";
interface Props {
	isAdded: boolean;
}

let { isAdded }: Props = $props();
</script>

{#if isAdded}
	<Button
		variant="headerAction"
		size="headerAction"
		class="pointer-events-none gap-1 cursor-default disabled:opacity-100"
		disabled={true}
	>
		<CheckCircle weight="fill" size={12} class="text-green-500" />
		{"Added"}
	</Button>
{:else}
	<Button
		variant="headerAction"
		size="headerAction"
		class="gap-1 opacity-0 transition-opacity group-hover:opacity-100"
	>
		<DownloadSimple size={12} />
		{"Import"}
	</Button>
{/if}
