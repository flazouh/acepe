<script lang="ts">
	import IconArrowRight from "@tabler/icons-svelte/icons/arrow-right";
	import IconArrowLeft from "@tabler/icons-svelte/icons/arrow-left";
	import IconRefresh from "@tabler/icons-svelte/icons/refresh";
	import IconExternalLink from "@tabler/icons-svelte/icons/external-link";

	import EmbeddedIconButton from "./embedded-icon-button.svelte";

	interface Props {
		onBack?: (() => void) | undefined;
		onForward?: (() => void) | undefined;
		onReload?: (() => void) | undefined;
		onOpenExternal?: (() => void) | undefined;
		backLabel?: string;
		forwardLabel?: string;
		reloadLabel?: string;
		openExternalLabel?: string;
		showNavigation?: boolean;
		showExternal?: boolean;
	}

	let {
		onBack,
		onForward,
		onReload,
		onOpenExternal,
		backLabel = "Back",
		forwardLabel = "Forward",
		reloadLabel = "Refresh",
		openExternalLabel = "Open in browser",
		showNavigation = true,
		showExternal = false,
	}: Props = $props();
</script>

	{#if showNavigation}
		<EmbeddedIconButton onclick={() => onBack?.()} title={backLabel} ariaLabel={backLabel}>
			{#snippet children()}<IconArrowLeft class="h-4 w-4" />{/snippet}
		</EmbeddedIconButton>
		<EmbeddedIconButton onclick={() => onForward?.()} title={forwardLabel} ariaLabel={forwardLabel}>
			{#snippet children()}<IconArrowRight class="h-4 w-4" />{/snippet}
		</EmbeddedIconButton>
		<EmbeddedIconButton onclick={() => onReload?.()} title={reloadLabel} ariaLabel={reloadLabel}>
			{#snippet children()}<IconRefresh class="h-4 w-4" />{/snippet}
		</EmbeddedIconButton>
	{/if}
	{#if showExternal}
		<EmbeddedIconButton
			onclick={() => onOpenExternal?.()}
			title={openExternalLabel}
			ariaLabel={openExternalLabel}
		>
			{#snippet children()}<IconExternalLink class="h-4 w-4" />{/snippet}
		</EmbeddedIconButton>
	{/if}
