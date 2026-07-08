<script lang="ts">
	import AgentCopyButton from "./agent-copy-button.svelte";
	import { ButtonGroup } from "../button-group/index.js";
	import { cn } from "../../lib/utils.js";

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

	const textToneClass = $derived(isAssistant ? "text-muted-foreground" : "text-muted-foreground/70");

	// Fused chip-style meta row — secondary shell with hairline segment dividers.
	const dividerClass = "border-l border-border/30";
	const labelSegmentClass =
		"flex shrink-0 items-center px-1.5 py-1 text-xs leading-none tabular-nums transition-colors";
</script>

<ButtonGroup class="overflow-hidden rounded-md bg-secondary">
	{#if showModel}
		<span class={cn(labelSegmentClass, textToneClass)}>{model}</span>
	{/if}
	{#if timestampLabel}
		<span
			class={cn(labelSegmentClass, textToneClass, showModel && dividerClass)}
			title={timestampTitle}
		>
			{timestampLabel}
		</span>
	{/if}
	{#if showCopy}
		<AgentCopyButton
			{text}
			class={cn(textToneClass, (showModel || timestampLabel) && dividerClass)}
		/>
	{/if}
</ButtonGroup>
