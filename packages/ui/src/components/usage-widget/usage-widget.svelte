<script lang="ts">
import { Selector } from "../selector/index.js";
import {
	selectorPanelEmptyStateClass,
	selectorPanelListClass,
} from "../selector/selector-panel.classes.js";
import UsageAgentIcon from "./usage-agent-icon.svelte";
import UsageVerticalMeter from "./usage-vertical-meter.svelte";
import {
	clampPercent,
	getProgressAriaValue,
	getToneTextClass,
	getVerticalMeterFillClass,
	getVerticalMeterMetricLabel,
} from "./usage-widget-state.js";
import type { UsageMetricTone, UsageWidgetModel } from "./types.js";

interface Props {
	model: UsageWidgetModel;
	onRefresh?: () => void;
}

let { model, onRefresh }: Props = $props();
let open = $state(false);

const panelProviders = $derived(
	model.providers.filter((provider) => provider.state === "ok"),
);

function toneTextClass(tone: UsageMetricTone): string {
	return getToneTextClass(tone);
}

function triggerItemAriaLabel(
	item: UsageWidgetModel["triggerLimits"][number],
): string {
	return `${item.providerName} ${item.label}: ${item.leftLabel}`;
}

function handleOpenChange(nextOpen: boolean): void {
	if (nextOpen) {
		onRefresh?.();
	}
	open = nextOpen;
}
</script>

<div class="relative">
	<Button
		variant="ghost"
		size="chromeIconMeter"
		class="font-mono text-[11px]"
		aria-label={model.copy.triggerLabel}
		aria-expanded={open}
		aria-haspopup="dialog"
		onclick={toggleOpen}
	>
		{#snippet children()}
			<span
				class="flex h-3.5 max-w-[320px] items-center gap-1 overflow-hidden leading-none"
				data-usage-widget-trigger
			>
				{#if model.triggerLimits.length > 0}
					{#each model.triggerLimits as item (item.id)}
						<span
							class="flex shrink-0 items-center gap-1"
							aria-label={triggerItemAriaLabel(item)}
							title={triggerItemAriaLabel(item)}
						>
							{#if item.providerBrand !== null}
								<ProviderMark
									brand={item.providerBrand}
									label={item.providerName}
									class="size-3.5 shrink-0 opacity-80 grayscale-0"
								/>
							{:else}
								<span
									class="flex size-3.5 shrink-0 items-center justify-center font-mono text-[8px] leading-none text-muted-foreground"
								>
									{item.initials}
								</span>
							{/if}
							<span
								class="flex shrink-0 items-center gap-0.5"
								role="progressbar"
								aria-label={triggerItemAriaLabel(item)}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={clampPercent(item.percentUsed)}
							>
								<span class="w-[36px]">
									<SegmentedProgressBar
										ariaLabel=""
										decorative={true}
										fillMode="wholeBarRamp"
										label=""
										percent={clampPercent(item.percentUsed)}
										segmentCount={SEGMENTED_PROGRESS_USAGE_COMPACT_SEGMENT_COUNT}
										showPercent={false}
										variant="downloadCompact"
									/>
								</span>
								<AnimateNumber
									value={clampPercent(item.percentUsed)}
									format={{ maximumFractionDigits: 0 }}
									suffix="%"
									duration={450}
									blur={10}
									class="font-mono text-[9px] font-medium leading-none tabular-nums {toneTextClass(
										item.tone
									)}"
								/>
							</span>
						</span>
					{/each}
				{:else}
					<span class="flex shrink-0 items-center -space-x-1" aria-hidden="true">
						{#each model.providers.slice(0, 3) as provider (provider.id)}
							{#if provider.providerBrand !== null}
								<ProviderMark
									brand={provider.providerBrand}
									label={provider.name}
									class="size-3.5 shrink-0 opacity-75 grayscale-0"
								/>
							{/if}
						{/each}
					</span>
					<span class="tabular-nums {toneTextClass(model.summary.tone)}">
						{model.summary.value}
					</span>
				{/if}
			</span>
		{/snippet}
	</Button>

	{#if open}
		<div
			class="fixed right-2 top-9 z-[var(--overlay-z)] w-[284px] max-w-[calc(100vw-20px)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
			data-usage-widget-panel
			role="dialog"
			aria-label={model.copy.triggerLabel}
		>
			{#if model.triggerLimits.length > 0}
				{#each model.triggerLimits as item, index (item.id)}
					<UsageVerticalMeter
						providerBrand={item.providerBrand}
						providerName={item.providerName}
						initials={item.initials}
						percent={clampPercent(item.percentUsed)}
						fillClass={getVerticalMeterFillClass(index, item.tone)}
						ariaLabel={triggerItemAriaLabel(item)}
					/>
				{/each}
			{:else}
				<span class="flex shrink-0 items-center -space-x-1" aria-hidden="true">
					{#each model.providers.slice(0, 3) as provider (provider.id)}
						<UsageAgentIcon
							providerBrand={provider.providerBrand}
							providerName={provider.name}
							initials={provider.initials}
							class="opacity-75"
						/>
					{/each}
				</span>
				<span class="tabular-nums {toneTextClass(model.summary.tone)}">
					{model.summary.value}
				</span>
			{/if}
		</span>
	{/snippet}

	<div data-usage-widget-panel>
		{#if panelProviders.length === 0}
			<div class={selectorPanelEmptyStateClass}>
				{model.copy.emptyLabel}
			</div>
		{:else}
			<div class="{selectorPanelListClass} max-h-[440px]">
				{#each panelProviders as provider (provider.id)}
					<section class="py-0.5">
						<div class="mb-1 flex items-center gap-2 px-0.5">
							<UsageAgentIcon
								providerBrand={provider.providerBrand}
								providerName={provider.name}
								initials={provider.initials}
								class="opacity-85"
							/>
							<h3 class="shrink-0 text-[12px] font-medium leading-none text-foreground">
								{provider.name}
							</h3>
						</div>

						<div class="space-y-1 px-0.5">
							{#each provider.lines as line, lineIndex (`${provider.id}-${line.type}-${line.label}`)}
								{#if line.type === "progress"}
									<div class="flex items-end gap-2 py-0.5">
										<UsageVerticalMeter
											label={getVerticalMeterMetricLabel(line.label)}
											percent={getProgressAriaValue(line)}
											fillClass={getVerticalMeterFillClass(lineIndex, line.tone)}
											ariaLabel={`${provider.name} ${line.label}: ${line.leftLabel}`}
										/>
										<div class="min-w-0 flex-1">
											<div class="flex items-baseline justify-between gap-2">
												<span class="text-[11px] leading-none text-muted-foreground">{line.label}</span>
												<span
													class="font-mono text-[11px] font-medium tabular-nums leading-none {toneTextClass(
														line.tone
													)}"
												>
													{line.leftLabel}
												</span>
											</div>
											{#if line.resetLabel !== null}
												<div
													class="mt-1 font-mono text-[10px] tabular-nums leading-none text-muted-foreground/60"
												>
													{line.resetLabel}
												</div>
											{/if}
										</div>
									</div>
								{:else}
									<div class="flex items-baseline justify-between gap-2">
										<div class="min-w-0">
											<div class="text-[11px] leading-tight text-muted-foreground">{line.label}</div>
											{#if line.subtitle !== null}
												<div class="truncate text-[10px] leading-tight text-muted-foreground/55">
													{line.subtitle}
												</div>
											{/if}
										</div>
										<span
											class="shrink-0 font-mono text-[11px] font-medium tabular-nums {toneTextClass(
												line.tone
											)}"
										>
											{line.value}
										</span>
									</div>
								{/if}
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</Selector>
