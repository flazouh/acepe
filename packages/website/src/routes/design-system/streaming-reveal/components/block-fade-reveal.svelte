<script lang="ts">
/**
 * Renders `block-fade`: whole blocks (paragraph / bullet list / fenced
 * code) fade in once complete, instead of animating per character or
 * per word. `block-fade` is a passthrough mode in the engine — `visibleText`
 * always equals `targetText` — so all the pacing here is block-completion
 * detection, not char timing.
 *
 * `splitIntoBlocks` re-derives the block list from `visibleText` on every
 * update. Its last element may still be growing (streamed mid-block), so
 * it's held back — never rendered — until either another block appears
 * after it or the controller reports `done`. The rendered list is then
 * index-keyed so already-shown blocks never remount (and never re-fade)
 * as later blocks are appended.
 */
import { fade } from "svelte/transition";
import type { RevealState } from "@acepe/ui/streaming-reveal";
import { splitIntoBlocks } from "./reveal-text-utils";

interface Props {
	state: RevealState;
}

let { state }: Props = $props();

const blocks = $derived(splitIntoBlocks(state.visibleText));
// Hold the last block back — it may still be mid-stream — until either a
// following block shows up (proving it's complete) or the stream is done.
const visibleBlocks = $derived(
	state.done ? blocks : blocks.slice(0, Math.max(blocks.length - 1, 0))
);

// Mirrors the --duration-fast (250ms) motion token; see word-fade-reveal
// for why this is a literal rather than a var() reference.
const BLOCK_FADE_MS = 240;
</script>

<div class="reveal-block-fade-text">
	{#each visibleBlocks as block, index (index)}
		<div class="reveal-block" transition:fade={{ duration: BLOCK_FADE_MS }}>
			{#if block.isCode}
				<pre class="reveal-block-code"><code>{block.text}</code></pre>
			{:else}
				<p class="reveal-block-paragraph">{block.text}</p>
			{/if}
		</div>
	{/each}
</div>

<style>
	.reveal-block-fade-text {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.reveal-block-paragraph {
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	.reveal-block-code {
		white-space: pre-wrap;
		overflow-wrap: break-word;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
		padding: 0.75rem;
	}
</style>
