<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "../../lib/utils.js";
import { BrandShaderBackground } from "../brand-shader-background/index.js";

type BrandShaderVariant = "acepe" | "luminar";

interface Props {
	/** Card content, rendered on the iris surface. */
	children: Snippet;
	/** Brand shader palette. Defaults to the onboarding "luminar" look. */
	variant?: BrandShaderVariant;
	/** Extra classes merged onto the surface container. */
	class?: string;
}

let { children, variant = "luminar", class: className }: Props = $props();
</script>

<!--
	Iris card: a bounded panel carrying the same brand-shader branding as the
	onboarding background, with a forced-light token context so content uses
	normal tokens (text-foreground, bg-primary, …) and reads legibly on it.
-->
<div class={cn("iris-card relative isolate overflow-hidden", className)}>
	<BrandShaderBackground {variant} fallback="gradient" />
	<div class="relative z-10">
		{@render children()}
	</div>
</div>

<style>
	.iris-card {
		/* Forced-light token context — re-asserts light tokens for the subtree so
		   children read correctly on the light iridescent surface regardless of the
		   active theme. */
		--background: #f7f4ff;
		--foreground: #111113;
		--card: #fbf9ff;
		--card-foreground: #0d0d0d;
		--popover: #fbf9ff;
		--popover-foreground: #0d0d0d;
		--primary: #171719;
		--primary-foreground: #fbf9ff;
		--secondary: #ede9f7;
		--secondary-foreground: #171719;
		--muted: #f1eef8;
		--muted-foreground: #696574;
		--accent: #ede9f7;
		--accent-foreground: #0d0d0d;
		--destructive: #b42318;
		--destructive-foreground: #ffffff;
		--border: #ded8ea;
		--input: #ded8ea;
		--ring: #a9c2ff;
		color-scheme: light;
	}
</style>
