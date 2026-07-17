<script lang="ts">
/**
 * Shared chrome for one reveal-mode panel: label, description, a
 * "streaming…" indicator that stops once `state.done`, and a fixed-size
 * content box so the four panels stay equal-width/equal-height for a fair
 * side-by-side comparison. The actual text rendering is delegated to the
 * renderer matching `mode` — three strategies (plain drip, per-word fade,
 * per-block fade) cover all four modes since `instant` and `buffer` share
 * a renderer.
 */
import type { RevealMode, RevealState } from "@acepe/ui/streaming-reveal";
import BlockFadeReveal from "./block-fade-reveal.svelte";
import PlainReveal from "./plain-reveal.svelte";
import WordFadeReveal from "./word-fade-reveal.svelte";

interface Props {
	mode: RevealMode;
	label: string;
	description: string;
	state: RevealState;
}

let { mode, label, description, state }: Props = $props();
</script>

<article
	class="flex h-[28rem] flex-col overflow-hidden rounded-2xl border border-border bg-card"
	data-testid={`reveal-panel-${mode}`}
>
	<header class="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
		<div>
			<p class="text-sm font-medium text-foreground">{label}</p>
			<p class="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
		</div>
		<span class="reveal-status" class:reveal-status--done={state.done} aria-hidden="true">
			<span class="reveal-status-dot"></span>
			streaming
		</span>
	</header>

	<div class="flex-1 overflow-y-auto px-4 py-4 font-mono text-[13px] leading-6 text-foreground" data-testid={`reveal-panel-${mode}-content`}>
		{#if mode === "block-fade"}
			<BlockFadeReveal {state} />
		{:else if mode === "buffer-fade"}
			<WordFadeReveal {state} />
		{:else}
			<PlainReveal {state} />
		{/if}
	</div>
</article>

<style>
	.reveal-status {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.125rem;
		font-family: var(--font-mono, monospace);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted-foreground);
		transition: opacity var(--duration-quick) var(--ease-out);
	}

	.reveal-status--done {
		opacity: 0;
	}

	.reveal-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--muted-foreground);
		animation: reveal-status-pulse 1.4s var(--ease-in-out) infinite;
	}

	@keyframes reveal-status-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
</style>
