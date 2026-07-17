<script lang="ts">
/**
 * Shared chrome for one reveal-mode panel: label, description, a
 * "streaming…" indicator that stops once `state.done`, and a fixed-size
 * content box so the four panels stay equal-width/equal-height for a fair
 * side-by-side comparison. All four modes render through the SAME real-app
 * `NativeMarkdown` component fed the engine's smoothed `visibleText`; the
 * only difference is the `reveal` prop, so this page shows exactly how each
 * strategy behaves against production markdown (code blocks, lists, emphasis).
 */
import type { RevealMode, RevealState } from "@acepe/ui/streaming-reveal";
import { NativeMarkdown } from "@acepe/ui/native-markdown";

interface Props {
	mode: RevealMode;
	label: string;
	description: string;
	state: RevealState;
}

let { mode, label, description, state }: Props = $props();

// buffer-fade fades each word as it appears; block-fade fades whole blocks;
// instant and buffer paint without a fade (buffer still drips via the engine).
const reveal = $derived<"none" | "word" | "block">(
	mode === "buffer-fade" ? "word" : mode === "block-fade" ? "block" : "none",
);

// block-fade reveals whole blocks, not characters: feed NativeMarkdown only the
// completed-block prefix (everything up to the last blank-line boundary) so a
// half-typed block stays hidden until it finishes, then surfaces and fades in as
// a unit. Once the stream ends, show everything. Other modes render the raw
// dripped text.
const markdown = $derived.by(() => {
	if (mode !== "block-fade" || state.done) return state.visibleText;
	const boundary = state.visibleText.lastIndexOf("\n\n");
	return boundary === -1 ? "" : state.visibleText.slice(0, boundary);
});
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

	<div class="flex-1 overflow-y-auto px-4 py-4 text-[13px] leading-6 text-foreground" data-testid={`reveal-panel-${mode}-content`}>
		<NativeMarkdown {markdown} mode="streaming" {reveal} />
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
