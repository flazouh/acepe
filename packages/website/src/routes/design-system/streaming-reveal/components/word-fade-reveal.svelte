<script lang="ts">
/**
 * Renders `buffer-fade`: same char-level drip as `buffer`, plus a soft
 * per-word fade-in on the freshly-revealed tail.
 *
 * `visibleText` is re-split into word tokens on every update, but the
 * `{#each ... (index)}` is keyed by array position, not content. Because
 * `visibleText` only ever grows, existing indices never remount — only
 * newly-appended indices at the tail mount for the first time, and only
 * mounting triggers Svelte's `fade` transition. That's what confines the
 * fade to "recently revealed words" without reading `justRevealed`
 * directly: a token born this update IS the just-revealed tail.
 *
 * Opacity-only by construction: `svelte/transition`'s `fade` animates
 * nothing but `opacity`, so there's no blur/transform/mask-image risk on
 * WKWebView.
 */
import { fade } from "svelte/transition";
import type { RevealState } from "@acepe/ui/streaming-reveal";
import { splitIntoWordTokens } from "./reveal-text-utils";

interface Props {
	state: RevealState;
}

let { state }: Props = $props();

const words = $derived(splitIntoWordTokens(state.visibleText));

// Mirrors the --duration-quick (150ms) motion token. Svelte transition
// params are plain numbers, not CSS custom properties, so the value is
// duplicated here rather than referenced.
const WORD_FADE_MS = 140;
</script>

<div class="reveal-word-fade-text">
	{#each words as word, index (index)}<span transition:fade={{ duration: WORD_FADE_MS }}>{word}</span>{/each}
</div>

<style>
	.reveal-word-fade-text {
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}
</style>
