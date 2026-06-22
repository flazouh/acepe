<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import {
		buildDiscreteFilledSegments,
		buildVoiceDownloadSegments,
		clampVoiceDownloadPercent,
		formatVoiceDownloadPercent,
		getLevelStageFillColor,
	} from "./voice-download-progress.js";
	import {
		getVoiceDownloadProgressRenderMode,
		isLevelPaletteVariant,
		voiceDownloadProgressVariants,
		type VoiceDownloadProgressVariant,
	} from "./voice-download-progress-variants.js";

	interface Props {
		ariaLabel: string;
		decorative?: boolean;
		filledSegmentCount?: number;
		label: string;
		percent: number;
		segmentCount: number;
		showPercent?: boolean;
		variant?: VoiceDownloadProgressVariant;
	}

	const {
		ariaLabel,
		decorative = false,
		filledSegmentCount,
		label,
		percent,
		segmentCount,
		showPercent = true,
		variant = "download",
	}: Props = $props();

	const classes = $derived(voiceDownloadProgressVariants({ variant }));
	const renderMode = $derived(getVoiceDownloadProgressRenderMode(variant));
	const isLevelPalette = $derived(isLevelPaletteVariant(variant));
	const isDiscreteFilledOnly = $derived(renderMode === "discreteFilledOnly");
	const isGroupedSetupBar = $derived(renderMode === "discreteGroupedAll");
	const percentLabel = $derived(formatVoiceDownloadPercent(percent));
	const segments = $derived(
		filledSegmentCount != null
			? buildDiscreteFilledSegments(filledSegmentCount, segmentCount)
			: buildVoiceDownloadSegments(percent, segmentCount)
	);
	const clampedPercent = $derived(
		filledSegmentCount != null && segmentCount > 0
			? (filledSegmentCount / segmentCount) * 100
			: clampVoiceDownloadPercent(percent)
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

	function getSegmentFillStyle(isFilled: boolean): string | undefined {
		if (!isFilled || levelFillColor == null) {
			return undefined;
		}

		return `--segment-fill: ${levelFillColor}`;
	}

	function getLevelSegmentFillStyle(): string | undefined {
		if (levelFillColor == null) {
			return undefined;
		}

		return `--segment-fill: ${levelFillColor}`;
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
		style={`--voice-segment-count: ${segmentCount}; --voice-filled-count: ${activeLevelRank};`}
		role={decorative ? undefined : "progressbar"}
		aria-valuemin={decorative ? undefined : 0}
		aria-valuemax={decorative ? undefined : 100}
		aria-valuenow={decorative ? undefined : Math.round(clampedPercent)}
	>
		{#if isGroupedSetupBar && filledSegmentCount != null}
			{#each Array.from({ length: segmentCount }, (_, index) => index) as index (index)}
				{@const isFilled = index < filledSegmentCount}
				<div
					class={cn(classes.segment(), isFilled ? classes.segmentFilled() : undefined)}
					style={isFilled ? getLevelSegmentFillStyle() : undefined}
				></div>
			{/each}
		{:else if isDiscreteFilledOnly}
			{#each levelBarFilledIndexes as index (index)}
				<div
					class={cn(classes.segment(), classes.segmentFilled())}
					style={getLevelSegmentFillStyle()}
				></div>
			{/each}
		{:else}
			{#each segments as isFilled, index (index)}
				<div
					class={cn(classes.segment(), isFilled ? classes.segmentFilled() : undefined)}
					style={getSegmentFillStyle(isFilled)}
				></div>
			{/each}
		{/if}
	</div>

	{#if showPercent}
		<span class={classes.percent()}>{percentLabel}</span>
	{/if}
</div>
