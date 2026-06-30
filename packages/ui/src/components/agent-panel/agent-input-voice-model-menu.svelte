<!--
  AgentInputVoiceModelMenu - Three-dot dropdown next to the mic button showing voice models.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte.
  Accepts model list and callbacks as props; state machine lives in the desktop.
-->
<script lang="ts">
	import { DownloadSimple, Trash } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		dropdownMenuItemTypographyClass,
		dropdownMenuSectionTypographyClass,
	} from "../dropdown-menu/dropdown-menu-typography.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { Selector } from "../selector/index.js";
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
		downloadLabel?: string;
		uninstallLabel?: string;
		onSelectModel: (modelId: string) => void;
		onDownloadModel: (modelId: string) => void;
		onUninstallModel: (modelId: string) => void;
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
		downloadLabel = "Download",
		uninstallLabel = "Uninstall",
		onSelectModel,
		onDownloadModel,
		onUninstallModel,
		embeddedInGroup = true,
	}: Props = $props();

	let menuOpen = $state(false);

	const modelRows = $derived(
		getVoiceModelRows({
			models,
			selectedModelId,
			downloadingModelId,
		})
	);

	/** Prevent bits-ui MenuItem from synthesizing row select on nested button clicks. */
	function isolateNestedMenuActionPointer(event: Event): void {
		event.stopPropagation();
	}
</script>

<Selector
	bind:open={menuOpen}
	{embeddedInGroup}
	triggerIcon="dots"
	showChevron={false}
	triggerSize={embeddedInGroup ? "composerChipIcon" : "chromeIcon"}
	triggerAriaLabel={menuLabel}
	tooltipTitle={menuLabel}
	side="top"
	align="end"
>
	{#snippet renderButton()}{/snippet}

	{#if modelsLoading}
		<div class="{dropdownMenuItemTypographyClass} text-muted-foreground">
			{loadingLabel}
		</div>
	{:else}
		{#each modelRows as row (row.model.id)}
			<DropdownMenu.Item
				closeOnSelect={row.model.isDownloaded}
				onSelect={(event) => {
					if (!row.model.isDownloaded) {
						event.preventDefault();
						return;
					}
					onSelectModel(row.model.id);
				}}
				class="group/item transition-colors py-1 {row.isSelected ? 'bg-accent' : ''}"
			>
				<div class="flex w-full min-w-0 items-center gap-2">
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span
							class="truncate {dropdownMenuItemTypographyClass} {row.model.isDownloaded
								? ''
								: 'text-muted-foreground'}"
						>
							{row.model.name}
						</span>
						<span class="{dropdownMenuSectionTypographyClass} text-muted-foreground">
							{row.sizeLabel}
						</span>
					</div>

					{#if row.isDownloading}
						<SegmentedProgressBar
							ariaLabel={`Downloading ${row.model.name}`}
							label=""
							percent={downloadPercent}
							segmentCount={12}
							showPercent={true}
							variant="downloadCompact"
						/>
					{:else if row.model.isDownloaded}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							role="group"
							class="shrink-0"
							onpointerdown={isolateNestedMenuActionPointer}
							onpointerup={isolateNestedMenuActionPointer}
							onmousedown={isolateNestedMenuActionPointer}
							onmouseup={isolateNestedMenuActionPointer}
							onclick={isolateNestedMenuActionPointer}
						>
							<Button
								variant="ghost"
								size="icon-2xs"
								aria-label={uninstallLabel}
								onclick={(event: MouseEvent) => {
									event.preventDefault();
									event.stopPropagation();
									onUninstallModel(row.model.id);
								}}
							>
								<Trash weight="bold" />
							</Button>
						</div>
					{:else}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							role="group"
							class="shrink-0"
							onpointerdown={isolateNestedMenuActionPointer}
							onpointerup={isolateNestedMenuActionPointer}
							onmousedown={isolateNestedMenuActionPointer}
							onmouseup={isolateNestedMenuActionPointer}
							onclick={isolateNestedMenuActionPointer}
						>
							<Button
								variant="ghost"
								size="icon-2xs"
								aria-label={downloadLabel}
								onclick={(event: MouseEvent) => {
									event.preventDefault();
									event.stopPropagation();
									onDownloadModel(row.model.id);
								}}
							>
								<DownloadSimple weight="bold" />
							</Button>
						</div>
					{/if}
				</div>
			</DropdownMenu.Item>
		{/each}
	{/if}
</Selector>
