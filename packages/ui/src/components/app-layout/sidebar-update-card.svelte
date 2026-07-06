<script lang="ts">
import { Button } from "../button/index.js";
import { RoundedIcon } from "../icons/index.js";
import IrisCard from "../iris-card/iris-card.svelte";
import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
import TextShimmer from "../text-shimmer/text-shimmer.svelte";
import {
	DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	getSidebarUpdateCardCopy,
	getSidebarUpdateCardVariantDefinition,
	type SidebarUpdateCardVariant,
} from "./sidebar-update-card-variants.js";
import type { SidebarUpdateKind } from "./types.js";

const PROGRESS_SEGMENT_COUNT = 28;

interface Props {
	/** Gradient variant from the sidebar update card design system. */
	variant?: SidebarUpdateCardVariant;
	/** Current updater stage driving the card's appearance. */
	kind: SidebarUpdateKind;
	/** Target version string (without leading `v`), or `null` when unknown. */
	version: string | null;
	/** Download/install progress, 0–100. Only used while downloading/installing. */
	percent?: number;
	/** Invoked on click for actionable states (install / retry). */
	onclick: () => void;
}

let {
	variant = DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	kind,
	version,
	percent = 0,
	onclick,
}: Props = $props();

const variantDef = $derived(getSidebarUpdateCardVariantDefinition(variant));
const inProgress = $derived(kind === "downloading" || kind === "installing");
const clampedPercent = $derived(Math.min(Math.max(percent, 0), 100));
const copy = $derived(
	getSidebarUpdateCardCopy({
		kind,
		version,
		percent: clampedPercent,
	}),
);

const shellClass = $derived(
	kind === "error"
		? `${variantDef.shellClass} ring-1 ring-destructive/30`
		: variantDef.shellClass,
);

const installTitle = $derived(
	version ? `Download and install ${version}` : "Download and install",
);
</script>

<IrisCard
	class={shellClass}
	panelPreset={variantDef.panelPreset}
	surfaceTokens={variantDef.surfaceTokens}
>
	<div class="flex w-full flex-col gap-2 px-3 py-2.5">
		<div class="flex min-w-0 items-center justify-between gap-2">
			{#if inProgress}
				<TextShimmer class="min-w-0 truncate text-xs font-semibold text-foreground">
					{copy.title}
				</TextShimmer>
			{:else}
				<span class="min-w-0 truncate text-xs font-semibold text-foreground">{copy.title}</span>
			{/if}

			{#if kind === "available" || kind === "error"}
				<Button
					size="xs"
					class={variantDef.ctaClass}
					title={kind === "available" ? installTitle : copy.title}
					aria-label={kind === "available" ? installTitle : copy.title}
					{onclick}
				>
					{copy.ctaLabel}
					{#if kind === "error"}
						<RoundedIcon name="refresh" class="size-3" />
					{/if}
				</Button>
			{/if}
		</div>

		{#if inProgress}
			<SegmentedProgressBar
				ariaLabel={copy.progressLabel}
				decorative
				label=""
				percent={clampedPercent}
				segmentCount={PROGRESS_SEGMENT_COUNT}
				showPercent={false}
				variant="downloadFillWidth"
			/>
		{/if}
	</div>
</IrisCard>
