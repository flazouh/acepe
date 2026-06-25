<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";
	import { Button } from "../button/index.js";
	import { ProviderMark } from "../provider-mark/index.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import {
		clampPercent,
		getProgressAriaValue,
		getToneTextClass,
	} from "./usage-widget-state.js";
	import type { UsageMetricLine, UsageMetricTone, UsageWidgetModel } from "./types.js";

	interface Props {
		model: UsageWidgetModel;
		onRefresh?: () => void;
	}

	let { model, onRefresh }: Props = $props();
	let open = $state(false);

	const panelProviders = $derived(model.providers.filter((provider) => provider.state === "ok"));

	function toneTextClass(tone: UsageMetricTone): string {
		return getToneTextClass(tone);
	}

	function markerLeft(line: UsageMetricLine): string {
		if (line.type !== "progress" || line.projectedPercent === null) {
			return "0%";
		}

		return `${clampPercent(line.projectedPercent)}%`;
	}

	function triggerItemAriaLabel(item: UsageWidgetModel["triggerLimits"][number]): string {
		return `${item.providerName} ${item.label}: ${item.leftLabel}`;
	}

	function toggleOpen(): void {
		const nextOpen = !open;
		if (nextOpen) {
			onRefresh?.();
		}
		open = nextOpen;
	}
</script>

<div class="relative">
	<Button
		variant="chromeIcon"
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
										label=""
										percent={clampPercent(item.percentUsed)}
										segmentCount={10}
										showPercent={false}
										variant="usageCompact"
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
			{#if panelProviders.length === 0}
				<div class="px-1 py-0.5 text-center text-[11px] text-muted-foreground">
					{model.copy.emptyLabel}
				</div>
			{:else}
				<div class="max-h-[440px] divide-y divide-border/40 overflow-y-auto px-1 py-0.5">
					{#each panelProviders as provider (provider.id)}
						<section class="py-0.5">
							<div class="mb-1 flex items-center gap-2">
								{#if provider.providerBrand !== null}
									<ProviderMark
										brand={provider.providerBrand}
										label={provider.name}
										class="size-3.5 shrink-0 opacity-85 grayscale-0"
									/>
								{:else}
									<span
										class="flex size-3.5 shrink-0 items-center justify-center font-mono text-[9px] leading-none text-muted-foreground"
									>
										{provider.initials}
									</span>
								{/if}
								<h3 class="shrink-0 text-[12px] font-medium leading-none text-foreground">
									{provider.name}
								</h3>
							</div>

							<div class="space-y-1 px-1">
								{#each provider.lines as line (`${provider.id}-${line.type}-${line.label}`)}
									{#if line.type === "progress"}
										<div class="py-0.5">
											<div class="mb-1 flex items-baseline justify-between gap-2">
												<span class="text-[11px] leading-none text-muted-foreground">{line.label}</span>
												<span
													class="font-mono text-[11px] font-medium tabular-nums leading-none {toneTextClass(
														line.tone
													)}"
												>
													{line.leftLabel}
												</span>
											</div>
											<div
												class="relative min-w-0"
												role="progressbar"
												aria-label={line.label}
												aria-valuemin="0"
												aria-valuemax="100"
												aria-valuenow={getProgressAriaValue(line)}
											>
												<SegmentedProgressBar
													ariaLabel=""
													decorative={true}
													label=""
													percent={getProgressAriaValue(line)}
													segmentCount={18}
													showPercent={false}
													variant="usageFillWidth"
												/>
												{#if line.projectedPercent !== null}
													<div
														class="absolute top-0 h-2.5 w-px rounded-full bg-foreground/45"
														style="left: {markerLeft(line)}"
														title="Projected use at reset"
														aria-hidden="true"
													></div>
												{/if}
											</div>
											{#if line.resetLabel !== null}
												<div
													class="mt-1 text-right font-mono text-[10px] tabular-nums leading-none text-muted-foreground/60"
												>
													{line.resetLabel}
												</div>
											{/if}
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
	{/if}
</div>
