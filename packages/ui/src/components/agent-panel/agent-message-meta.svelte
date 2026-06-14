<script lang="ts">
	import { IconCheck } from "@tabler/icons-svelte";
	import { Copy } from "phosphor-svelte";

	interface Props {
		text: string;
		timestampMs?: number;
		variant: "user" | "assistant";
	}

	let { text, timestampMs, variant }: Props = $props();

	let copied = $state(false);

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

	function clearCopiedSoon(): void {
		setTimeout(() => {
			copied = false;
		}, 1600);
	}

	function handleCopy(): void {
		if (!text.trim()) return;

		navigator.clipboard
			.writeText(text)
			.then(() => {
				copied = true;
				clearCopiedSoon();
			})
			.catch((error: unknown) => {
				console.error("[AGENT_MESSAGE_META_COPY_FAILED]", error);
			});
	}
</script>

{#if isAssistant}
	<div class="inline-flex items-center overflow-hidden rounded-lg border border-border/60 bg-background/85 backdrop-blur-sm">
		{#if timestampLabel}
			<span
				class="px-2 text-[11px] tabular-nums text-muted-foreground"
				title={timestampTitle}
			>
				{timestampLabel}
			</span>
			<div class="h-4 w-px bg-border/60"></div>
		{/if}
		<button
			type="button"
			class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
			title={copied ? "Copied!" : "Copy message"}
			onclick={handleCopy}
		>
			{#if copied}
				<IconCheck size={13} stroke={2} />
			{:else}
				<Copy size={13} weight="fill" />
			{/if}
		</button>
	</div>
{:else}
	<div class="inline-flex items-center overflow-hidden rounded-lg border border-border/40 bg-muted/40">
		{#if timestampLabel}
			<span class="px-2 text-[11px] tabular-nums text-muted-foreground/70" title={timestampTitle}>
				{timestampLabel}
			</span>
			<div class="h-4 w-px bg-border/40"></div>
		{/if}
		<button
			type="button"
			class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
			title={copied ? "Copied!" : "Copy message"}
			onclick={handleCopy}
		>
			{#if copied}
				<IconCheck size={13} stroke={2} />
			{:else}
				<Copy size={13} weight="fill" />
			{/if}
		</button>
	</div>
{/if}
