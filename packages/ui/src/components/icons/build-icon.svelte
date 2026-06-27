<script lang="ts">
	import { Screwdriver } from "phosphor-svelte";

	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
		style?: string;
	}

	let { size = "md", class: className, style }: Props = $props();

	const sizeClasses = {
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<span
	class="build-icon-root inline-flex shrink-0 items-center justify-center {sizeClasses[size]} {className ? className : ''}"
	style={style}
>
	<Screwdriver class="block size-full max-h-full max-w-full text-current" weight="fill" />
</span>

<style>
	.build-icon-root {
		color: var(--build-icon, var(--color-success, var(--success)));
	}

	/* Mode bar and similar: parent sets color; keep inheriting that path. */
	.build-icon-root.text-current {
		color: currentColor;
	}

	/*
	 * Phosphor sets fill on the SVG root; `currentColor` must match this wrapper’s `color`.
	 * Keeping `color` + optional `style` on the span (not the SVG) avoids cases where the mint
	 * `--build-icon` token was ignored in dark theme.
	 */
	.build-icon-root :global(svg) {
		fill: currentColor;
	}
</style>
