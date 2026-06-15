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

	// Subtle tone differences between user and assistant chips.
	const containerToneClass = $derived(
		isAssistant
			? "border-border/60 bg-background/85 backdrop-blur-sm"
			: "border-border/40 bg-muted/40",
	);
	const textToneClass = $derived(isAssistant ? "text-muted-foreground" : "text-muted-foreground/70");
	const dividerToneClass = $derived(isAssistant ? "bg-border/60" : "bg-border/40");
</script>

<div class="inline-flex items-center overflow-hidden rounded-lg border {containerToneClass}">
	{#if showModel}
		<span class="whitespace-nowrap px-2 text-[11px] {textToneClass}">{model}</span>
	{/if}
	{#if timestampLabel}
		{#if showModel}
			<div class="h-4 w-px shrink-0 {dividerToneClass}"></div>
		{/if}
		<span
			class="px-2 text-[11px] tabular-nums {textToneClass}"
			title={timestampTitle}
		>
			{timestampLabel}
		</span>
	{/if}
	{#if showCopy}
		{#if showModel || timestampLabel}
			<div class="h-4 w-px shrink-0 {dividerToneClass}"></div>
		{/if}
		<AgentCopyButton {text} class={textToneClass} />
	{/if}
</div>
