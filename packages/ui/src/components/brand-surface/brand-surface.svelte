<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "../../lib/utils.js";
import { BrandShaderBackground } from "../brand-shader-background/index.js";

type BrandSurfaceVariant = "acepe" | "luminar";

interface Props {
	/** Brand shader palette. Defaults to the onboarding "luminar" look. */
	variant?: BrandSurfaceVariant;
	/** Optional content pinned to the top-right corner (e.g. a theme toggle). */
	topRight?: Snippet;
	/** Centered surface content. */
	children: Snippet;
	/** Extra classes merged onto the surface container. */
	class?: string;
}

let {
	variant = "luminar",
	topRight,
	children,
	class: className,
}: Props = $props();
</script>

<!--
	Shared full-bleed brand surface: the brand shader background, a soft tint, and
	a centered content area. Used by onboarding and the blocking update overlay so
	both sit in the same shell.
-->
<div
	class={cn(
		"relative z-10 flex min-h-full w-full items-center justify-center overflow-hidden bg-background px-6 py-16",
		className
	)}
>
	<BrandShaderBackground {variant} fallback="gradient" />
	<div class="absolute inset-0 bg-background/12"></div>
	{#if topRight}
		<div class="absolute right-6 top-6 z-20">
			{@render topRight()}
		</div>
	{/if}
	{@render children()}
</div>
