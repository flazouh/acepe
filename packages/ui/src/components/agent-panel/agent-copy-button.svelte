<script lang="ts">
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

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
	const iconStyle = $derived(`width: ${iconSize}px; height: ${iconSize}px;`);

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
		variant="ghost"
		size="icon-chrome"
		data-header-control
		title={tooltip}
		aria-label={tooltip}
		onclick={handleCopy}
		class={className}
	>
		{#snippet children()}
			{#if copied}
				<RoundedIcon name="check" class="shrink-0" style={iconStyle} />
			{:else}
				<RoundedIcon name="copy" class="shrink-0" style={iconStyle} />
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
			<RoundedIcon name="check" class="shrink-0" style={iconStyle} />
		{:else}
			<RoundedIcon name="copy" class="shrink-0" style={iconStyle} />
		{/if}
	</button>
{/if}
