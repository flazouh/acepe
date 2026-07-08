<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "$lib/utils.js";
import SettingsSectionHeader from "./settings-section-header.svelte";

interface Props {
	title?: string;
	description?: string;
	/** Extra classes applied to the outer section wrapper. */
	class?: string;
	/**
	 * Wrap the rows in an elevated card (Cursor-style). Disable for table or
	 * custom-layout sections that manage their own surface.
	 */
	card?: boolean;
	headerActions?: Snippet;
	children: Snippet;
}

let {
	title,
	description,
	class: className,
	card = true,
	headerActions,
	children,
}: Props = $props();
</script>

<section class={cn("mb-6 last:mb-0", className)}>
	{#if title}
		<SettingsSectionHeader
			variant="subsection"
			{title}
			{description}
			actions={headerActions}
		/>
	{/if}
	{#if card}
		<div class="overflow-hidden rounded-xl border border-border/60 bg-card">
			{@render children()}
		</div>
	{:else}
		{@render children()}
	{/if}
</section>
