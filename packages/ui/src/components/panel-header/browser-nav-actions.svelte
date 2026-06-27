<script lang="ts">
	import { IconArrowRight } from "@tabler/icons-svelte";
	import { IconArrowLeft } from "@tabler/icons-svelte";
	import { IconRefresh } from "@tabler/icons-svelte";
	import { IconExternalLink } from "@tabler/icons-svelte";

	import { Button } from "../button/index.js";

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
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			onclick={() => onBack?.()}
			title={backLabel}
			aria-label={backLabel}
		>
			{#snippet children()}<IconArrowLeft class="h-4 w-4" />{/snippet}
		</Button>
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			onclick={() => onForward?.()}
			title={forwardLabel}
			aria-label={forwardLabel}
		>
			{#snippet children()}<IconArrowRight class="h-4 w-4" />{/snippet}
		</Button>
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			onclick={() => onReload?.()}
			title={reloadLabel}
			aria-label={reloadLabel}
		>
			{#snippet children()}<IconRefresh class="h-4 w-4" />{/snippet}
		</Button>
	{/if}
	{#if showExternal}
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			onclick={() => onOpenExternal?.()}
			title={openExternalLabel}
			aria-label={openExternalLabel}
		>
			{#snippet children()}<IconExternalLink class="h-4 w-4" />{/snippet}
		</Button>
	{/if}
