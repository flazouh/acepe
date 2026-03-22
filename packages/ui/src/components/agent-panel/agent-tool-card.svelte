<script lang="ts">
	import type { Snippet } from "svelte";

	type Variant = "default" | "muted" | "card";

	interface Props {
		/** Visual variant: default (accent), muted (row), or card (e.g. web search). */
		variant?: Variant;
		/** Optional extra Tailwind classes (e.g. flex, font-mono). */
		class?: string;
		children: Snippet;
	}

	let { variant = "default", class: className = "", children }: Props = $props();

	const base = "rounded-sm border border-border overflow-hidden";
	const variantClasses: Record<Variant, string> = {
		default: "bg-accent/50",
		muted: "bg-muted/30",
		card: "bg-card",
	};
	const wrapperClass = $derived(`${base} ${variantClasses[variant]} ${className}`.trim());
</script>

<div class={wrapperClass}>
	{@render children()}
</div>
