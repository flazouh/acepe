<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "$lib/utils.js";
import SettingsSectionHeader from "./settings-section-header.svelte";

interface Props {
	title?: string;
	description?: string;
	/** Extra classes applied to the outer section wrapper. */
	class?: string;
	headerActions?: Snippet;
	children: Snippet;
}

let { title, description, class: className, headerActions, children }: Props = $props();
</script>

<section class={cn("mb-4 last:mb-0", className)}>
	{#if title}
		<SettingsSectionHeader
			variant="subsection"
			{title}
			{description}
			actions={headerActions}
		/>
	{/if}
	{@render children()}
</section>
