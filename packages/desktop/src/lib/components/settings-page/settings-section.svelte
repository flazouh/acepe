<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "$lib/utils.js";
import SettingsSectionHeader from "./settings-section-header.svelte";

interface Props {
	title?: string;
	description?: string;
	/** When true, renders children as raw content (no grouped card). Use for sections that own their own container (e.g., full-width lists). */
	unstyled?: boolean;
	/** Extra classes applied to the outer section wrapper. */
	class?: string;
	/** Extra classes applied to the grouped card (ignored when `unstyled`). */
	cardClass?: string;
	headerActions?: Snippet;
	children: Snippet;
}

let {
	title,
	description,
	unstyled = false,
	class: className,
	cardClass,
	headerActions,
	children,
}: Props = $props();
</script>

<section class={cn("mb-10", className)}>
	{#if title}
		<SettingsSectionHeader {title} {description} actions={headerActions} />
	{/if}
	{#if unstyled}
		{@render children()}
	{:else}
		<div
			class={cn(
				"overflow-hidden rounded-lg bg-muted/20 shadow-sm",
				cardClass
			)}
		>
			{@render children()}
		</div>
	{/if}
</section>
