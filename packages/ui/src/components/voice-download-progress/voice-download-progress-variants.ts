import { tv, type VariantProps } from "tailwind-variants";

const segmentFilledClass =
	"bg-[var(--segment-fill,var(--token-download-progress))]";

export const voiceDownloadProgressVariants = tv({
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
					"grid grid-flow-col auto-cols-[4px] h-3 rounded-sm border border-border/55 bg-muted-foreground/10",
				segment:
					"h-full border-r border-border/45 first:rounded-l-sm last:rounded-r-sm last:border-r-0",
				percent: "text-[10px] tracking-wide",
			},
			downloadCompact: {
				root: "items-center gap-1.5",
				segments:
					"grid grid-flow-col auto-cols-[3px] h-2.5 rounded-sm border border-border/55 bg-muted-foreground/10",
				segment:
					"h-full w-[3px] border-r border-border/45 first:rounded-l-sm last:rounded-r-sm last:border-r-0",
				percent: "text-[9px] tracking-wide",
			},
			downloadFillWidth: {
				root: "w-full items-center gap-1.5",
				segments:
					"grid h-2.5 w-full flex-1 rounded-sm border border-border/55 bg-muted-foreground/10 [grid-template-columns:repeat(var(--voice-segment-count),minmax(0,1fr))]",
				segment:
					"h-full w-full border-r border-border/45 first:rounded-l-sm last:rounded-r-sm last:border-r-0",
				percent: "text-[9px] tracking-wide",
			},
			reasoningDiscrete: {
				root: "items-center gap-1.5",
				segments:
					"flex flex-col-reverse items-stretch w-1 gap-0.5 border-0 bg-transparent",
				segment: "h-[3px] w-full shrink-0 rounded-sm border-0",
			},
			setupReasoningBar: {
				root: "h-full min-h-0 w-full flex-1 items-stretch gap-0 self-stretch",
				segments:
					"flex h-full min-h-0 w-full flex-1 flex-col-reverse items-stretch gap-0 rounded-none border-0 bg-transparent",
				segment:
					"min-h-0 flex-1 rounded-none border-0 bg-muted-foreground/[0.18] first:rounded-none first:rounded-br-md last:rounded-none last:rounded-tr-md",
			},
		},
	},
	defaultVariants: {
		variant: "download",
	},
});

export type VoiceDownloadProgressVariant = NonNullable<
	VariantProps<typeof voiceDownloadProgressVariants>["variant"]
>;

export type VoiceDownloadProgressRenderMode =
	| "percent"
	| "discreteFilledOnly"
	| "discreteGroupedAll";

export function getVoiceDownloadProgressRenderMode(
	variant: VoiceDownloadProgressVariant
): VoiceDownloadProgressRenderMode {
	if (variant === "setupReasoningBar") {
		return "discreteGroupedAll";
	}

	if (variant === "reasoningDiscrete") {
		return "discreteFilledOnly";
	}

	return "percent";
}

export function isLevelPaletteVariant(variant: VoiceDownloadProgressVariant): boolean {
	return variant === "reasoningDiscrete" || variant === "setupReasoningBar";
}
