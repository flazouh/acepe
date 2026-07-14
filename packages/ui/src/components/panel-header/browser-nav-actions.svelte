<script lang="ts">
	import { Button } from "../button/index.js";
	import { HugeiconsIcon } from "../icons/index.js";

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
			variant="ghost"
			size="icon-sm"
			data-header-control
			onclick={() => onBack?.()}
			title={backLabel}
			aria-label={backLabel}
		>
			{#snippet children()}<HugeiconsIcon name="chevron-left" />{/snippet}
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			data-header-control
			onclick={() => onForward?.()}
			title={forwardLabel}
			aria-label={forwardLabel}
		>
			{#snippet children()}<HugeiconsIcon name="chevron-right" />{/snippet}
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			data-header-control
			onclick={() => onReload?.()}
			title={reloadLabel}
			aria-label={reloadLabel}
		>
			{#snippet children()}<HugeiconsIcon name="refresh" />{/snippet}
		</Button>
	{/if}
	{#if showExternal}
		<Button
			variant="ghost"
			size="icon-sm"
			data-header-control
			onclick={() => onOpenExternal?.()}
			title={openExternalLabel}
			aria-label={openExternalLabel}
		>
			{#snippet children()}
				<HugeiconsIcon
					name="open-in-new-window"
					data-testid="browser-nav-open-external-hugeicons-icon"
				/>
			{/snippet}
		</Button>
	{/if}
