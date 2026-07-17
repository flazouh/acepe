<script lang="ts">
/**
 * Renders `instant` and `buffer`: both hand us the text to paint as-is
 * (`instant` jumps `visibleText` to `targetText` on every push; `buffer`
 * drips it smoothly). No fade — the char-level drip itself is the
 * animation, so this component just needs to preserve line breaks.
 */
import type { RevealState } from "@acepe/ui/streaming-reveal";

interface Props {
	state: RevealState;
}

let { state }: Props = $props();
</script>

<div class="reveal-plain-text">{state.visibleText}</div>

<style>
	.reveal-plain-text {
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}
</style>
