<script lang="ts">
	import {
		buildDiscreteFilledSegments,
		buildVoiceDownloadSegments,
		clampVoiceDownloadPercent,
		formatVoiceDownloadPercent,
		getLevelStageFillColor,
		type SegmentFillPalette,
	} from "./voice-download-progress.js";

	type VoiceDownloadProgressOrientation = "horizontal" | "vertical";

	interface Props {
		ariaLabel: string;
		compact: boolean;
		decorative?: boolean;
		fillWidth?: boolean;
		filledSegmentCount?: number;
		label: string;
		orientation?: VoiceDownloadProgressOrientation;
		percent: number;
		segmentCount: number;
		segmentFillPalette?: SegmentFillPalette;
		setupBar?: boolean;
		showContainerBorder?: boolean;
		showPercent?: boolean;
	}

	const {
		ariaLabel,
		compact,
		decorative = false,
		fillWidth = false,
		filledSegmentCount,
		label,
		orientation = "horizontal",
		percent,
		segmentCount,
		segmentFillPalette = "download",
		setupBar = false,
		showContainerBorder = true,
		showPercent = true,
	}: Props = $props();

	const isVertical = $derived(orientation === "vertical");
	const isLevelPalette = $derived(segmentFillPalette === "level");
	const isLevelDiscreteBar = $derived(
		isLevelPalette && filledSegmentCount != null && filledSegmentCount > 0
	);
	const isGroupedSetupBar = $derived(
		setupBar && fillWidth && isVertical && isLevelPalette && segmentCount > 0
	);
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
		if (!isLevelDiscreteBar || filledSegmentCount == null) {
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
	class:compact
	class:fill-width={fillWidth}
	class:level-palette={isLevelPalette}
	class:no-container-border={!showContainerBorder}
	class:grouped-setup-bar={isGroupedSetupBar}
	class:setup-bar={setupBar}
	class:vertical={isVertical}
	class="voice-download-progress flex min-w-0 gap-2 {isGroupedSetupBar
		? 'h-full min-h-0 items-stretch'
		: 'items-center'}"
	aria-hidden={decorative ? true : undefined}
	aria-label={decorative ? undefined : ariaLabel}
>
	{#if label.length > 0}
		<span class="truncate text-[11px] font-medium text-foreground/70">{label}</span>
	{/if}

	<div
		class="voice-download-segments rounded-sm"
		class:vertical={isVertical}
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
					class="voice-download-segment"
					class:filled={isFilled}
					style={isFilled ? getLevelSegmentFillStyle() : undefined}
				></div>
			{/each}
		{:else if isLevelDiscreteBar}
			{#each levelBarFilledIndexes as index (index)}
				<div
					class="voice-download-segment filled"
					style={getLevelSegmentFillStyle()}
				></div>
			{/each}
		{:else}
			{#each segments as isFilled, index (index)}
				<div
					class:filled={isFilled}
					class="voice-download-segment"
					style={getSegmentFillStyle(isFilled)}
				></div>
			{/each}
		{/if}
	</div>

	{#if showPercent}
		<span class="voice-download-percent shrink-0 tabular-nums text-muted-foreground/55">
			{percentLabel}
		</span>
	{/if}
</div>

<style>
	.voice-download-progress {
		min-width: 0;
	}

	.fill-width {
		width: 100%;
	}

	.setup-bar.fill-width {
		align-self: stretch;
		width: 100%;
		height: 100%;
		gap: 0;
	}

	.setup-bar.fill-width .voice-download-segments {
		flex: 1 1 auto;
		min-height: 0;
	}

	.setup-bar.fill-width.vertical .voice-download-segments {
		display: flex;
		flex-direction: column-reverse;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
		height: 100%;
		gap: 1px;
		border: none;
		background: transparent;
		grid-auto-flow: initial;
		grid-auto-columns: initial;
		grid-auto-rows: initial;
	}

	.setup-bar.fill-width.level-palette.vertical .voice-download-segment {
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
		height: auto;
		border: none;
		border-radius: 0;
	}

	.setup-bar.fill-width.level-palette.vertical .voice-download-segment:not(.filled) {
		background: color-mix(in oklab, var(--muted-foreground) 18%, transparent);
	}

	.setup-bar.fill-width.level-palette.vertical .voice-download-segment.filled {
		background: var(--segment-fill, var(--token-download-progress));
	}

	.voice-download-segments {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 4px;
		align-items: stretch;
		height: 12px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
		background: color-mix(in oklab, var(--muted-foreground) 10%, transparent);
	}

	.no-container-border .voice-download-segments {
		border: none;
		background: transparent;
	}

	.fill-width .voice-download-segments {
		flex: 1 1 auto;
		width: 100%;
		grid-template-columns: repeat(var(--voice-segment-count), minmax(0, 1fr));
		grid-auto-flow: initial;
		grid-auto-columns: initial;
	}

	.voice-download-segment {
		min-width: 0;
		height: 100%;
		background: transparent;
		border-right: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		transition: background-color 180ms ease-out;
	}

	.voice-download-segment:first-child {
		border-top-left-radius: 2px;
		border-bottom-left-radius: 2px;
	}

	.voice-download-segment:last-child {
		border-top-right-radius: 2px;
		border-bottom-right-radius: 2px;
		border-right: none;
	}

	.voice-download-segment.filled {
		background: var(--segment-fill, var(--token-download-progress));
	}

	.fill-width .voice-download-segment {
		width: 100%;
	}

	.voice-download-percent {
		font-size: 10px;
		letter-spacing: 0.02em;
	}

	.compact {
		gap: 1.5px;
	}

	.compact .voice-download-segments {
		grid-auto-columns: 3px;
		height: 10px;
	}

	.compact .voice-download-segment {
		width: 3px;
	}

	.compact .voice-download-percent {
		font-size: 9px;
	}

	.compact.fill-width .voice-download-segments {
		grid-template-columns: repeat(var(--voice-segment-count), minmax(0, 1fr));
		grid-auto-flow: initial;
		grid-auto-columns: initial;
	}

	.voice-download-segments.vertical {
		display: flex;
		flex-direction: column-reverse;
		align-items: stretch;
		width: 10px;
		height: 24px;
		grid-auto-flow: initial;
		grid-auto-columns: initial;
		grid-auto-rows: initial;
	}

	.compact.vertical .voice-download-segments {
		width: 5px;
		height: 16px;
	}

	.setup-bar.compact.vertical .voice-download-segments {
		width: 6px;
		height: 20px;
	}

	.level-palette.compact.vertical .voice-download-segments {
		width: 4px;
		height: auto;
		gap: 0.5px;
	}

	.level-palette.setup-bar.compact.vertical .voice-download-segments {
		width: 5px;
	}

	.level-palette.vertical .voice-download-segment {
		flex: 0 0 3px;
		min-height: 3px;
		height: 3px;
		width: 100%;
		border: none;
		border-radius: 1px;
	}

	.level-palette.vertical .voice-download-segment:first-child {
		border-bottom-left-radius: 2px;
		border-bottom-right-radius: 2px;
	}

	.level-palette.vertical .voice-download-segment:last-child {
		border-top-left-radius: 2px;
		border-top-right-radius: 2px;
	}

	.vertical .voice-download-segment {
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
		border-right: none;
		border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		border-top-left-radius: 0;
		border-top-right-radius: 0;
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.vertical .voice-download-segment:first-child {
		border-bottom-left-radius: 2px;
		border-bottom-right-radius: 2px;
	}

	.vertical .voice-download-segment:last-child {
		border-top: none;
		border-top-left-radius: 2px;
		border-top-right-radius: 2px;
	}

	:global(html.light) .voice-download-segments {
		border-color: color-mix(in srgb, var(--border) 88%, var(--foreground));
	}

	:global(html.light) .voice-download-segment {
		border-right-color: color-mix(in srgb, var(--border) 82%, var(--foreground));
	}

	:global(html.light) .vertical .voice-download-segment {
		border-top-color: color-mix(in srgb, var(--border) 82%, var(--foreground));
	}

	/* Grouped setup bar must win over compact vertical level-palette defaults. */
	.voice-download-progress.grouped-setup-bar.setup-bar.fill-width.level-palette.compact.vertical {
		align-items: stretch;
		height: 100%;
		min-height: 0;
	}

	.voice-download-progress.grouped-setup-bar.setup-bar.fill-width.level-palette.compact.vertical
		.voice-download-segments {
		display: flex;
		flex-direction: column-reverse;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
		height: 100%;
		min-height: 0;
		gap: 1px;
		border: none;
		background: transparent;
		grid-auto-flow: initial;
		grid-auto-columns: initial;
		grid-auto-rows: initial;
	}

	.voice-download-progress.grouped-setup-bar.setup-bar.fill-width.level-palette.compact.vertical
		.voice-download-segment {
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
		height: auto;
		border: none;
		border-radius: 0;
	}

	.voice-download-progress.grouped-setup-bar.setup-bar.fill-width.level-palette.compact.vertical
		.voice-download-segment:not(.filled) {
		background: color-mix(in oklab, var(--muted-foreground) 18%, transparent);
	}

	.voice-download-progress.grouped-setup-bar.setup-bar.fill-width.level-palette.compact.vertical
		.voice-download-segment.filled {
		background: var(--segment-fill, var(--token-download-progress));
	}
</style>
