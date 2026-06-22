<!--
  AgentInputVoiceModelMenu - Three-dot dropdown next to the mic button showing voice models.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte.
  Accepts model list and callbacks as props; state machine lives in the desktop.
-->
<script lang="ts">
	import { Check, DotsThreeVertical, DownloadSimple } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { EmbeddedIconButton } from "../panel-header/index.js";
	import { VoiceDownloadProgress } from "../voice-download-progress/index.js";

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

	interface TierMeta {
		label: string;
		description: string;
	}

	const TIER_ORDER: readonly string[] = ["tiny", "base", "small", "medium", "large"];

	const TIER_META: Record<string, TierMeta> = {
		tiny: { label: "Tiny", description: "Fastest · least accurate" },
		base: { label: "Base", description: "Fast · basic accuracy" },
		small: { label: "Small", description: "Balanced · recommended" },
		medium: { label: "Medium", description: "Slower · more accurate" },
		large: { label: "Large", description: "Slowest · most accurate" },
	};

	function tierFor(modelId: string): string {
		const head = modelId.split(".")[0] ?? modelId;
		return head.toLowerCase();
	}

	function variantLabelFor(modelId: string): string {
		return modelId.endsWith(".en") ? "English" : "Multilingual";
	}

	function formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024 * 1024) {
			return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
		}
		return `${Math.round(bytes / (1024 * 1024))} MB`;
	}

	interface ModelGroup {
		tier: string;
		meta: TierMeta;
		models: AgentInputVoiceModel[];
	}

	const groupedModels = $derived.by<readonly ModelGroup[]>(() => {
		const byTier = new Map<string, AgentInputVoiceModel[]>();
		const extraOrder: string[] = [];
		for (const model of models) {
			const tier = tierFor(model.id);
			const bucket = byTier.get(tier);
			if (bucket) {
				bucket.push(model);
			} else {
				byTier.set(tier, [model]);
				if (!TIER_ORDER.includes(tier)) {
					extraOrder.push(tier);
				}
			}
		}
		const orderedTiers = [...TIER_ORDER, ...extraOrder];
		const result: ModelGroup[] = [];
		for (const tier of orderedTiers) {
			const tierModels = byTier.get(tier);
			if (!tierModels || tierModels.length === 0) {
				continue;
			}
			const meta = TIER_META[tier] ?? { label: tier, description: "" };
			result.push({ tier, meta, models: tierModels });
		}
		return result;
	});
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<EmbeddedIconButton
				{...props}
				title={menuLabel}
				ariaLabel={menuLabel}
				class={embeddedInGroup
					? "rounded-none border-0 border-l border-border/30 bg-transparent shadow-none hover:!bg-accent"
					: ""}
			>
				{#snippet children()}
					<DotsThreeVertical class="h-3 w-3" weight="bold" />
				{/snippet}
			</EmbeddedIconButton>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="top" align="end" sideOffset={8} class="w-fit max-w-[280px]">
		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading class="text-[10px]">
				{menuLabel}
			</DropdownMenu.GroupHeading>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		{#if modelsLoading}
			<div class="px-2 py-1.5 text-xs text-muted-foreground">
				{loadingLabel}
			</div>
		{:else}
			{#each groupedModels as group, groupIndex (group.tier)}
				{#if groupIndex > 0}
					<DropdownMenu.Separator />
				{/if}
				<div class="flex items-baseline justify-between gap-2 px-2 pt-1.5 pb-0.5">
					<span class="text-[11px] font-semibold text-foreground">{group.meta.label}</span>
					{#if group.meta.description}
						<span class="truncate text-[10px] text-muted-foreground">
							{group.meta.description}
						</span>
					{/if}
				</div>
				{#each group.models as model (model.id)}
					{@const isSelected = selectedModelId === model.id}
					{@const isDownloading = downloadingModelId === model.id}
					{@const variantLabel = variantLabelFor(model.id)}

					{#if model.isDownloaded}
						<DropdownMenu.Item class="min-h-7 py-1" onSelect={() => onSelectModel(model.id)}>
							<div class="flex w-full items-center gap-2">
								<Check
									class={isSelected ? "size-3 shrink-0 text-foreground" : "size-3 shrink-0 text-transparent"}
									weight="bold"
								/>
								<div class="flex flex-1 items-center min-w-0">
									<span class="truncate text-xs font-medium">{variantLabel}</span>
								</div>
								<span class="shrink-0 text-[10px] leading-none text-muted-foreground/40">
									{formatBytes(model.sizeBytes)}
								</span>
							</div>
						</DropdownMenu.Item>
					{:else}
						<div
							class="model-row relative z-10 flex min-h-7 items-center gap-2 px-2 py-1 text-xs font-medium select-none"
						>
							<Check class="size-3 shrink-0 text-transparent" weight="bold" />
							<div class="flex flex-1 items-center min-w-0">
								<span class="truncate text-xs font-medium text-muted-foreground">
									{variantLabel}
								</span>
							</div>

							{#if isDownloading}
								<VoiceDownloadProgress
									ariaLabel={`Downloading ${model.name}`}
									label=""
									percent={downloadPercent}
									segmentCount={20}
									showPercent={false}
									variant="downloadCompact"
								/>
							{:else}
								<Button
									variant="headerAction"
									size="headerAction"
									class="h-5 shrink-0 gap-0.5 px-1.5 py-0 text-[10px] leading-none font-mono"
									onclick={(e: MouseEvent) => {
										e.stopPropagation();
										onDownloadModel(model.id);
									}}
								>
									<span>{formatBytes(model.sizeBytes)}</span>
									<DownloadSimple class="size-2" weight="bold" />
								</Button>
							{/if}
						</div>
					{/if}
				{/each}
			{/each}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
