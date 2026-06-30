<script lang="ts">
	import { IconPlug } from "@tabler/icons-svelte";
	import { RoundedIcon } from "../icons/index.js";
	import { INLINE_ARTEFACT_PACKAGE_PATH } from "../inline-artefact-badge/inline-artefact-badge.styles.js";
	import { ProviderMark } from "../provider-mark/index.js";
	import AgentInputModeIcon from "./agent-input-mode-icon.svelte";
	import { getSlashCommandIconColor } from "./agent-input-slash-command-row-state.js";
	import type { SlashPaletteItem } from "./agent-input-slash-palette-state.js";

	interface Props {
		item: SlashPaletteItem;
		selected?: boolean;
		showPreviewButton?: boolean;
		onSelect?: () => void;
		onPreview?: () => void;
		onHover?: () => void;
	}

	let {
		item,
		selected = false,
		showPreviewButton = false,
		onSelect,
		onPreview,
		onHover,
	}: Props = $props();

	const iconColor = $derived(
		item.tokenType ? getSlashCommandIconColor(item.tokenType) : "currentColor"
	);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 {selected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/50'}"
	title={item.description ?? item.label}
	onclick={() => onSelect?.()}
	onmouseenter={() => onHover?.()}
>
	<div class="flex h-4 w-4 shrink-0 items-center justify-center" style="color: {iconColor};">
		{#if item.kind === "mode" && item.modeIconKind}
			<AgentInputModeIcon iconKind={item.modeIconKind} class="size-3.5" monochrome />
		{:else if item.kind === "model" && item.providerBrand}
			<ProviderMark
				brand={item.providerBrand}
				label={item.providerLabel ?? item.label}
				class="size-3.5"
			/>
		{:else if item.tokenType === "skill"}
			<svg viewBox="0 0 256 256" fill="currentColor" class="h-3 w-3" aria-hidden="true">
				<path d={INLINE_ARTEFACT_PACKAGE_PATH} />
			</svg>
		{:else if item.tokenType === "mcp"}
			<IconPlug class="h-3 w-3" />
		{:else}
			<RoundedIcon name="terminal" class="h-3 w-3" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex min-w-0 items-baseline gap-2">
			<span class="min-w-0 truncate text-[12px] font-medium leading-4">
				{item.label}
			</span>
			{#if item.kind !== "skill" && item.description && item.description.trim().length > 0}
				<span class="min-w-0 truncate text-[11px] leading-4 text-muted-foreground">
					{item.description}
				</span>
			{/if}
		</div>
	</div>
	{#if showPreviewButton}
		<button
			type="button"
			class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			title="Open readable details"
			aria-label="Open readable details for {item.label}"
			onclick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onPreview?.();
			}}
		>
			<span class="text-[10px] font-medium">i</span>
		</button>
	{/if}
</div>
