<script lang="ts">
import { onMount } from "svelte";
import type { Snippet } from "svelte";

interface Props {
	label: string;
	children?: Snippet;
	class?: string;
}

let { label, children, class: className = "" }: Props = $props();

let host: HTMLDivElement | null = $state(null);
let shouldRender = $state(false);

onMount(() => {
	if (!host) return;
	if (!("IntersectionObserver" in window)) {
		shouldRender = true;
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				shouldRender = true;
				observer.disconnect();
				return;
			}
		},
		{ rootMargin: "720px 0px" }
	);

	observer.observe(host);

	return () => observer.disconnect();
});
</script>

<div bind:this={host} class={className} data-lazy-feature-demo={label}>
	{#if shouldRender}
		{@render children?.()}
	{:else}
		<div
			class="flex h-full min-h-[180px] w-full items-center justify-center rounded-lg border border-border/50 bg-background/55"
			aria-label={`${label} placeholder`}
		>
			<div class="flex flex-col items-center gap-3 text-center">
				<div class="h-8 w-8 rounded-full border border-primary/35 bg-primary/10 shadow-[0_0_28px_rgba(247,126,44,0.22)]"></div>
				<div class="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
					{label}
				</div>
			</div>
		</div>
	{/if}
</div>
