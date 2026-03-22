<script lang="ts">
import IconSearch from "@tabler/icons-svelte/icons/search";
import { Input } from "$lib/components/ui/input/index.js";

interface Props {
	value?: string;
}

let { value = $bindable("") }: Props = $props();
</script>

<div class="relative">
	<IconSearch
		class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
	/>
	<Input type="text" placeholder="Search conversations..." bind:value class="pl-10 h-9" />
</div>
