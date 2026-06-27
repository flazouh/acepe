<!--
  AgentInputVoiceModelMenu - Three-dot dropdown next to the mic button showing voice models.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte.
  Accepts model list and callbacks as props; state machine lives in the desktop.
-->
<script lang="ts">
	import { DotsThreeVertical, DownloadSimple } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { EmbeddedIconButton, FusedOverflowDotsTrigger } from "../panel-header/index.js";
	import AgentInputSelectorItemRow from "./agent-input-selector-item-row.svelte";
	import {
		getVoiceModelRows,
		type AgentInputVoiceModel,
	} from "./agent-input-voice-model-menu-state.js";

	export type { AgentInputVoiceModel };

	interface Props {
		models: readonly AgentInputVoiceModel[];
		selectedModelId: string | null;
		modelsLoading?: boolean;
		downloadingModelId?: string | null;
		downloadPercent?: number;
		menuLabel?: string;
		loadingLabel?: string;
		onSelectModel: (modelId: string) => void;
		onDownloadModel: (modelId: string) => void;
		/** When true, styles the overflow trigger for a fused voice control button group. */
		embeddedInGroup?: boolean;
	}

	let {
		models,
		selectedModelId,
		modelsLoading = false,
		downloadingModelId = null,
		downloadPercent = 0,
		menuLabel = "Voice model",
		loadingLabel = "Loading voice models...",
		onSelectModel,
		onDownloadModel,
		embeddedInGroup = false,
	}: Props = $props();

	let menuOpen = $state(false);

	const modelRows = $derived(
		getVoiceModelRows({
			models,
			selectedModelId,
			downloadingModelId,
		})
	);
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{#if embeddedInGroup}
				<FusedOverflowDotsTrigger {...props} ariaLabel={menuLabel} title={menuLabel} />
			{:else}
				<EmbeddedIconButton {...props} title={menuLabel} ariaLabel={menuLabel}>
					{#snippet children()}
						<DotsThreeVertical class="h-3 w-3 shrink-0" weight="bold" />
					{/snippet}
				</EmbeddedIconButton>
			{/if}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="top" align="end" sideOffset={8} class="w-fit min-w-[11rem] p-1">
		{#if modelsLoading}
			<div class="px-2 py-1 text-xs text-muted-foreground">
				{loadingLabel}
			</div>
		{:else}
			{#each modelRows as row (row.model.id)}
				{#if row.model.isDownloaded}
					<AgentInputSelectorItemRow
						label={row.model.name}
						selected={row.isSelected}
						dense={true}
						onSelect={() => onSelectModel(row.model.id)}
					>
						{#snippet trailing()}
							<span class="shrink-0 text-[10px] leading-none text-muted-foreground/50">
								{row.sizeLabel}
							</span>
						{/snippet}
					</AgentInputSelectorItemRow>
				{:else}
					<div
						class="flex items-center gap-2 rounded-sm px-2 py-0.5 text-xs select-none"
					>
						<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
							{row.model.name}
						</span>

						{#if row.isDownloading}
							<SegmentedProgressBar
								ariaLabel={`Downloading ${row.model.name}`}
								label=""
								percent={downloadPercent}
								segmentCount={12}
								showPercent={true}
								variant="downloadCompact"
							/>
						{:else}
							<Button
								variant="headerAction"
								size="headerAction"
								class="h-5 shrink-0 gap-0.5 px-1 py-0 text-[10px] leading-none font-mono"
								onclick={(e: MouseEvent) => {
									e.stopPropagation();
									onDownloadModel(row.model.id);
								}}
							>
								<span>{row.sizeLabel}</span>
								<DownloadSimple class="size-2" weight="bold" />
							</Button>
						{/if}
					</div>
				{/if}
			{/each}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
