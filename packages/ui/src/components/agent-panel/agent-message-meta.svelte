<script lang="ts">
	import AgentCopyButton from "./agent-copy-button.svelte";

	interface Props {
		text: string;
		timestampMs?: number;
		variant: "user" | "assistant";
		/** User-friendly model name (e.g. "Opus 4.5"). Shown on assistant chips. */
		model?: string;
		/** Whether the chip renders its own copy button. Defaults to true. */
		showCopy?: boolean;
	}

	let { text, timestampMs, variant, model, showCopy = true }: Props = $props();

	const isAssistant = $derived(variant === "assistant");
	const timestampDate = $derived.by(() => {
		if (timestampMs == null || Number.isNaN(timestampMs)) return null;
		return new Date(timestampMs);
	});
	const timestampLabel = $derived.by(() => {
		if (timestampDate == null) return null;
		return timestampDate.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	});
	const timestampTitle = $derived.by(() => {
		if (timestampDate == null) return undefined;
		return timestampDate.toLocaleString();
	});

	const showModel = $derived(isAssistant && model != null && model.length > 0);

	// Match the soft-filled "setup card" look (e.g. the worktree setup card):
	// a borderless, rounded pill on a subtle `bg-input/30` fill. Tone only the
	// text/dividers per variant so user vs assistant chips still read distinct.
	const textToneClass = $derived(isAssistant ? "text-muted-foreground" : "text-muted-foreground/70");
</script>

<div class="inline-flex items-center gap-1.5 overflow-hidden rounded-lg bg-input/30 px-2 py-0.5">
	{#if showModel}
		<span class="whitespace-nowrap text-[11px] {textToneClass}">{model}</span>
	{/if}
	{#if timestampLabel}
		<span class="text-[11px] tabular-nums {textToneClass}" title={timestampTitle}>
			{timestampLabel}
		</span>
	{/if}
	{#if showCopy}
		<AgentCopyButton {text} class="rounded-md {textToneClass}" />
	{/if}
</div>
