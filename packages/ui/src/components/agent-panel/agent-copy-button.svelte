<script lang="ts">
	import { IconCheck } from "@tabler/icons-svelte";
	import { Copy } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	interface Props {
		text: string;
		/** Tooltip when idle / after copy. */
		title?: string;
		copiedTitle?: string;
		/** `header` matches embedded panel header icon buttons (`size-5`). */
		size?: "message" | "header";
		/** Extra classes appended to the button (tone, rounding, border, …). */
		class?: string;
	}

	let {
		text,
		title = "Copy message",
		copiedTitle = "Copied!",
		size = "message",
		class: className = "",
	}: Props = $props();

	let copied = $state(false);

	const tooltip = $derived(copied ? copiedTitle : title);
	const iconSize = $derived(size === "header" ? 12 : 13);

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
				console.error("[AGENT_MESSAGE_COPY_FAILED]", error);
			});
	}
</script>

{#if size === "header"}
	<Button
		variant="chromeIcon"
		size="chromeIcon"
		data-header-control
		title={tooltip}
		aria-label={tooltip}
		onclick={handleCopy}
		class={className}
	>
		{#snippet children()}
			{#if copied}
				<IconCheck size={iconSize} stroke={2} />
			{:else}
				<Copy size={iconSize} weight="fill" />
			{/if}
		{/snippet}
	</Button>
{:else}
	<button
		type="button"
		class="inline-flex h-6 w-6 shrink-0 items-center justify-center transition-colors hover:bg-accent/60 hover:text-foreground {className}"
		title={tooltip}
		onclick={handleCopy}
	>
		{#if copied}
			<IconCheck size={iconSize} stroke={2} />
		{:else}
			<Copy size={iconSize} weight="fill" />
		{/if}
	</button>
{/if}
