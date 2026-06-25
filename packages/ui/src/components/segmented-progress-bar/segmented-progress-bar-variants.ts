import { tv, type VariantProps } from "tailwind-variants";

const segmentFilledClass =
	"bg-[var(--segment-fill,var(--token-download-progress))]";

const compactSegmentsClass =
	"grid grid-flow-col auto-cols-[3px] gap-px h-2.5 rounded-sm border border-border/55 bg-muted-foreground/10";

const usageCompactSegmentsClass =
	"grid grid-flow-col auto-cols-[3px] h-2.5 rounded-sm border border-border/55 bg-muted-foreground/10";

const fillWidthSegmentsClass =
	"grid h-2.5 w-full flex-1 gap-px rounded-sm border border-border/55 bg-muted-foreground/10 [grid-template-columns:repeat(var(--segmented-progress-count),minmax(0,1fr))]";

const usageFillWidthSegmentsClass =
	"grid h-2.5 w-full flex-1 rounded-sm border border-border/55 bg-muted-foreground/10 [grid-template-columns:repeat(var(--segmented-progress-count),minmax(0,1fr))]";

export const segmentedProgressBarVariants = tv({
	slots: {
		root: "flex min-w-0",
		label: "truncate text-[11px] font-medium text-foreground/70",
		segments: "overflow-hidden",
		segment:
			"min-w-0 bg-transparent transition-[background-color] duration-180 ease-out",
		segmentFilled: segmentFilledClass,
		percent: "shrink-0 tabular-nums text-muted-foreground/55",
	},
	variants: {
		variant: {
			download: {
				root: "items-center gap-2",
				segments:
					"grid grid-flow-col auto-cols-[4px] gap-px h-3 rounded-sm border border-border/55 bg-muted-foreground/10",
				segment: "h-full",
				percent: "text-[10px] tracking-wide",
			},
			downloadCompact: {
				root: "items-center gap-1.5",
				segments: compactSegmentsClass,
				segment: "h-full w-[3px]",
				percent: "shrink-0 text-[9px] text-muted-foreground/70",
			},
			downloadFillWidth: {
				root: "w-full items-center gap-1.5",
				segments: fillWidthSegmentsClass,
				segment: "h-full w-full",
				percent: "shrink-0 text-[9px] text-muted-foreground/70",
			},
			usageCompact: {
				root: "items-center gap-1.5",
				segments: usageCompactSegmentsClass,
				segment: "h-full w-[3px]",
				percent: "shrink-0 text-[9px] text-muted-foreground/70",
			},
			usageFillWidth: {
				root: "w-full items-center gap-1.5",
				segments: usageFillWidthSegmentsClass,
				segment: "h-full w-full",
				percent: "shrink-0 text-[9px] text-muted-foreground/70",
			},
			reasoningDiscrete: {
				root: "items-center gap-1.5",
				segments:
					"flex flex-col-reverse items-stretch w-1 gap-0.5 border-0 bg-transparent",
				segment: "h-[3px] w-full shrink-0 rounded-sm border-0",
			},
			setupReasoningBar: {
				root: "items-center gap-0 self-stretch",
				segments:
					"flex w-full flex-col-reverse items-stretch justify-center gap-[0.5px] rounded-none border-0 bg-transparent",
				segment: "h-[3px] w-full shrink-0 rounded-sm border-0",
			},
		},
	},
	defaultVariants: {
		variant: "download",
	},
});

export type SegmentedProgressBarVariant = NonNullable<
	VariantProps<typeof segmentedProgressBarVariants>["variant"]
>;

export type SegmentedProgressBarRenderMode =
	| "percent"
	| "discreteFilledOnly"
	| "discreteGroupedAll";

export function getSegmentedProgressBarRenderMode(
	variant: SegmentedProgressBarVariant
): SegmentedProgressBarRenderMode {
	if (variant === "setupReasoningBar") {
		return "discreteGroupedAll";
	}

	if (variant === "reasoningDiscrete") {
		return "discreteFilledOnly";
	}

	return "percent";
}

export function isLevelPaletteVariant(variant: SegmentedProgressBarVariant): boolean {
	return variant === "reasoningDiscrete" || variant === "setupReasoningBar";
}

export function isCompletenessRampVariant(variant: SegmentedProgressBarVariant): boolean {
	return variant === "usageCompact" || variant === "usageFillWidth";
}
