<script lang="ts">
import { PillButton } from "@acepe/ui";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	isAdded: boolean;
}

let { isAdded }: Props = $props();
</script>

{#if isAdded}
	<PillButton variant="soft" size="sm" class="pointer-events-none gap-1 cursor-default">
		{#snippet children()}
			<CheckCircle weight="fill" size={12} class="text-green-500" />
			{m.open_project_added()}
		{/snippet}
	</PillButton>
{:else}
	<PillButton variant="outline" size="sm" class="opacity-0 group-hover:opacity-100 transition-opacity gap-1">
		{#snippet children()}
			<DownloadSimple size={12} />
			{m.open_project_import()}
		{/snippet}
	</PillButton>
{/if}
