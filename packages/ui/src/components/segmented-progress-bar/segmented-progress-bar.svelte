<script lang="ts">
	import AnimateNumber from "../animate-number/animate-number.svelte";
	import { cn } from "../../lib/utils.js";
	import {
		buildDiscreteFilledSegments,
		buildPercentFilledSegments,
		clampSegmentedPercent,
		getCompletenessRampFillColor,
		getLevelStageFillColor,
	} from "./segmented-progress-bar.js";
	import {
		getSegmentedProgressBarRenderMode,
		isCompletenessRampVariant,
		isLevelPaletteVariant,
		segmentedProgressBarVariants,
		type SegmentedProgressBarVariant,
	} from "./segmented-progress-bar-variants.js";
	import type { SegmentedProgressBarFillMode } from "./segmented-progress-bar.js";

	interface Props {
		ariaLabel: string;
		decorative?: boolean;
		filledSegmentCount?: number;
		fillMode?: SegmentedProgressBarFillMode;
		label: string;
		percent: number;
		segmentCount: number;
		showPercent?: boolean;
		variant?: SegmentedProgressBarVariant;
	}

	const {
		ariaLabel,
		decorative = false,
		filledSegmentCount,
		fillMode = "uniform",
		label,
		percent,
		segmentCount,
		showPercent = true,
		variant = "download",
	}: Props = $props();

	const classes = $derived(segmentedProgressBarVariants({ variant }));
	const renderMode = $derived(getSegmentedProgressBarRenderMode(variant));
	const isLevelPalette = $derived(isLevelPaletteVariant(variant));
	const isCompletenessRamp = $derived(isCompletenessRampVariant(variant));
	const isDiscreteFilledOnly = $derived(renderMode === "discreteFilledOnly");
	const isGroupedSetupBar = $derived(renderMode === "discreteGroupedAll");
	const segments = $derived(
		filledSegmentCount != null
			? buildDiscreteFilledSegments(filledSegmentCount, segmentCount)
			: buildPercentFilledSegments(percent, segmentCount)
	);
	const clampedPercent = $derived(
		filledSegmentCount != null && segmentCount > 0
			? (filledSegmentCount / segmentCount) * 100
			: clampSegmentedPercent(percent)
	);
	const activeLevelRank = $derived.by(() => {
		if (filledSegmentCount != null) {
			return filledSegmentCount;
		}

		let filledCount = 0;
		for (const isFilled of segments) {
			if (isFilled) {
				filledCount = filledCount + 1;
			}
		}
		return filledCount;
	});
	const levelFillColor = $derived(
		isLevelPalette && segmentCount > 0 && activeLevelRank > 0
			? getLevelStageFillColor(activeLevelRank, segmentCount)
			: null
	);
	const levelBarFilledIndexes = $derived.by(() => {
		if (!isDiscreteFilledOnly || filledSegmentCount == null || filledSegmentCount <= 0) {
			return [];
		}

		const indexes: number[] = [];
		for (let index = 0; index < filledSegmentCount; index = index + 1) {
			indexes.push(index);
		}
		return indexes;
	});

	function getSegmentFillStyle(isFilled: boolean, segmentIndex: number): string | undefined {
		if (!isFilled) {
			return undefined;
		}

		if (fillMode === "wholeBarRamp" && segmentCount > 0 && activeLevelRank > 0) {
			return `--segment-fill: ${getCompletenessRampFillColor(activeLevelRank, segmentCount)}`;
		}

		if (isCompletenessRamp && segmentCount > 0) {
			return `--segment-fill: ${getCompletenessRampFillColor(segmentIndex + 1, segmentCount)}`;
		}

		if (levelFillColor != null) {
			return `--segment-fill: ${levelFillColor}`;
		}

		return undefined;
	}

	function getFilledSegmentBackgroundStyle(): string | undefined {
		if (levelFillColor == null) {
			return undefined;
		}

		return `background-color: ${levelFillColor}`;
	}
</script>

<div
	class={classes.root()}
	data-variant={variant}
	aria-hidden={decorative ? true : undefined}
	aria-label={decorative ? undefined : ariaLabel}
>
	{#if label.length > 0}
		<span class={classes.label()}>{label}</span>
	{/if}

	<div
		class={classes.segments()}
		style={`--segmented-progress-count: ${segmentCount}; --segmented-filled-count: ${activeLevelRank};`}
		role={decorative ? undefined : "progressbar"}
		aria-valuemin={decorative ? undefined : 0}
		aria-valuemax={decorative ? undefined : 100}
		aria-valuenow={decorative ? undefined : Math.round(clampedPercent)}
	>
		{#if isGroupedSetupBar && filledSegmentCount != null}
			{#each Array.from({ length: segmentCount }, (_, index) => index) as index (index)}
				{@const isFilled = index < filledSegmentCount}
				<div
					class={cn(
						classes.segment(),
						isFilled ? classes.segmentFilled() : "bg-muted-foreground/[0.18]"
					)}
					data-filled={isFilled ? "true" : undefined}
					style={isFilled ? getFilledSegmentBackgroundStyle() : undefined}
				></div>
			{/each}
		{:else if isDiscreteFilledOnly}
			{#each levelBarFilledIndexes as index (index)}
				<div class={classes.segment()} style={getFilledSegmentBackgroundStyle()}></div>
			{/each}
		{:else}
			{#each segments as isFilled, index (index)}
				<div
					class={cn(classes.segment(), isFilled ? classes.segmentFilled() : undefined)}
					style={getSegmentFillStyle(isFilled, index)}
				></div>
			{/each}
		{/if}
	</div>

	{#if showPercent}
		<AnimateNumber
			value={Math.round(clampedPercent)}
			format={{ maximumFractionDigits: 0 }}
			suffix="%"
			duration={450}
			blur={14}
			class={cn(classes.percent(), "font-medium")}
		/>
	{/if}
</div>
