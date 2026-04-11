<!--
  AgentInputVoiceModelMenu - Three-dot dropdown next to the mic button showing voice models.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte.
  Accepts model list and callbacks as props; state machine lives in the desktop.
-->
<script lang="ts">
	import { Check, DotsThreeVertical, DownloadSimple } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { PillButton } from "../pill-button/index.js";

	export interface AgentInputVoiceModel {
		id: string;
		name: string;
		sizeBytes: number;
		isDownloaded: boolean;
	}

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
	}: Props = $props();

	let menuOpen = $state(false);

	function formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024 * 1024) {
			return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
		}
		return `${Math.round(bytes / (1024 * 1024))} MB`;
	}
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				type="button"
				class="voice-more-btn flex items-center justify-center rounded-full transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				class:voice-more-open={menuOpen}
				aria-label={menuLabel}
				{...props}
			>
				<DotsThreeVertical class="h-3.5 w-3.5" weight="bold" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" side="top" sideOffset={8} class="min-w-[220px]">
		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>
				{menuLabel}
			</DropdownMenu.GroupHeading>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		{#if modelsLoading}
			<div class="px-2 py-1.5 text-[11px] text-muted-foreground">
				{loadingLabel}
			</div>
		{:else}
			{#each models as model (model.id)}
				{@const isSelected = selectedModelId === model.id}
				{@const isDownloading = downloadingModelId === model.id}

				{#if model.isDownloaded}
					<DropdownMenu.Item onSelect={() => onSelectModel(model.id)}>
						<div class="flex w-full items-center gap-2">
							<Check
								class={isSelected ? "size-3 shrink-0 text-foreground" : "size-3 shrink-0 text-transparent"}
								weight="bold"
							/>
							<div class="flex flex-1 items-center min-w-0">
								<span class="truncate text-[12px] font-medium">{model.name}</span>
							</div>
							<span class="text-[10px] text-muted-foreground/40 shrink-0">
								{formatBytes(model.sizeBytes)}
							</span>
						</div>
					</DropdownMenu.Item>
				{:else}
					<div
						class="model-row relative z-10 flex items-center gap-2 px-2 py-1 text-[11px] font-medium select-none border-b border-border/20 last:border-b-0"
					>
						<Check class="size-3 shrink-0 text-transparent" weight="bold" />
						<div class="flex flex-1 items-center min-w-0">
							<span class="truncate text-[12px] font-medium text-muted-foreground">
								{model.name}
							</span>
						</div>

						{#if isDownloading}
							<div class="flex items-center gap-[2px]" aria-label="Downloading {model.name}">
								{#each Array(20) as _, i (i)}
									<div
										class="rounded-full transition-all duration-150 {downloadPercent >= (i + 1) * 5
											? 'h-[9px] w-[3px] bg-foreground'
											: 'h-[6px] w-[3px] bg-foreground/25'}"
									></div>
								{/each}
							</div>
						{:else}
							<PillButton
								variant="invert"
								size="xs"
								onclick={(e: MouseEvent) => {
									e.stopPropagation();
									onDownloadModel(model.id);
								}}
							>
								{#snippet children()}
									<span class="font-mono">{formatBytes(model.sizeBytes)}</span>
								{/snippet}
								{#snippet trailingIcon()}
									<DownloadSimple class="size-2.5" weight="bold" />
								{/snippet}
							</PillButton>
						{/if}
					</div>
				{/if}
			{/each}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<style>
	.voice-more-btn {
		width: 22px;
		height: 22px;
		color: var(--muted-foreground);
		opacity: 0;
		pointer-events: none;
		transition: opacity 150ms ease-out, color 150ms ease-out, transform 150ms ease-out;
	}
	.voice-more-open {
		opacity: 1;
		pointer-events: auto;
	}
	:global(.voice-controls:hover) .voice-more-btn {
		opacity: 1;
		pointer-events: auto;
	}
	.voice-more-btn:hover {
		color: var(--foreground);
		transform: scale(1.08);
	}
</style>
