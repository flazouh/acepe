<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "../../lib/utils.js";
import {
	buildBrandShaderPanelPreset,
	type BrandShaderPanelPreset,
} from "../../lib/brand-shader-panel-preset.js";
import { BRAND_SHADER_LUMINAR_PANEL_PALETTE } from "../../lib/brand-shader-palette.js";
import { BrandShaderBackground } from "../brand-shader-background/index.js";

type IrisCardSurfaceTokens = "light" | "dark";

const DEFAULT_PANEL_PRESET = buildBrandShaderPanelPreset({
	palette: BRAND_SHADER_LUMINAR_PANEL_PALETTE,
	shape: "blob",
	scale: 1,
});

interface Props {
	/** Card content, rendered on the iris surface. */
	children: Snippet;
	/** Panel shader preset driving the grain gradient. */
	panelPreset?: BrandShaderPanelPreset;
	/** Token context for legible content on the gradient surface. */
	surfaceTokens?: IrisCardSurfaceTokens;
	/** Extra classes merged onto the surface container. */
	class?: string;
}

let {
	children,
	panelPreset = DEFAULT_PANEL_PRESET,
	surfaceTokens = "light",
	class: className,
}: Props = $props();
</script>

<div
	class={cn(
		"iris-card relative isolate overflow-hidden",
		surfaceTokens === "dark" ? "iris-card--dark" : "iris-card--light",
		className,
	)}
>
	<BrandShaderBackground fallback="gradient" surface="panel" {panelPreset} />
	<div class="relative z-10">
		{@render children()}
	</div>
</div>

<style>
	.iris-card--light {
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

	.iris-card--dark {
		--background: #171719;
		--foreground: #f5f3ff;
		--card: #1f1f22;
		--card-foreground: #f5f3ff;
		--popover: #1f1f22;
		--popover-foreground: #f5f3ff;
		--primary: #f5f3ff;
		--primary-foreground: #171719;
		--secondary: #2a2a2e;
		--secondary-foreground: #f5f3ff;
		--muted: #2a2a2e;
		--muted-foreground: #a8a3b8;
		--accent: #2a2a2e;
		--accent-foreground: #f5f3ff;
		--destructive: #ef4444;
		--destructive-foreground: #ffffff;
		--border: #3a3a40;
		--input: #3a3a40;
		--ring: #ff9a5c;
		color-scheme: dark;
	}
</style>
