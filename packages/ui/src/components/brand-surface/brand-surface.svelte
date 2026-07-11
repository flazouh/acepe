<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "../../lib/utils.js";
import { BrandGradientBackground } from "../brand-gradient-background/index.js";

interface Props {
	/** Optional content pinned to the top-right corner (e.g. a theme toggle). */
	topRight?: Snippet;
	/** Centered surface content. */
	children: Snippet;
	/** Extra classes merged onto the surface container. */
	class?: string;
}

let { topRight, children, class: className }: Props = $props();
</script>

<!--
	Shared full-bleed brand surface: the canonical Iris background, a soft tint, and
	a centered content area. Used by onboarding and the blocking update overlay so
	both sit in the same shell.
-->
<div
	class={cn(
		"relative z-10 flex min-h-full w-full items-center justify-center overflow-hidden bg-background px-6 py-16",
		className
	)}
>
	<BrandGradientBackground />
	<div class="absolute inset-0 bg-background/12"></div>
	{#if topRight}
		<div class="absolute right-6 top-6 z-20">
			{@render topRight()}
		</div>
	{/if}
	{@render children()}
</div>
