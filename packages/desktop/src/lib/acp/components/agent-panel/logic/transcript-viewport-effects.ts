export type TranscriptRendererFallbackReason =
	| "zero_viewport"
	| "no_rendered_entries"
	| "adapter-anchor-missing"
	| "explicit-safety-mode";

export type TranscriptViewportEffectBase = {
	sessionId: string | null;
	generation: number;
};

export type TranscriptViewportEffect =
	| (TranscriptViewportEffectBase & {
			type: "MeasureViewport";
	  })
	| (TranscriptViewportEffectBase & {
			type: "RevealRow";
			targetKey: string;
			align: "start" | "center" | "end";
			reason:
				| "send-started"
				| "explicit-reveal"
				| "panel-activated"
				| "public-scroll-top";
	  })
	| (TranscriptViewportEffectBase & {
			type: "RevealTail";
			force: boolean;
			reason:
				| "rows-changed-following"
				| "send-started"
				| "panel-activated"
				| "public-scroll-bottom"
				| "public-follow";
	  })
	| (TranscriptViewportEffectBase & {
			type: "PreserveAnchor";
			anchorKey: string;
	  })
	| (TranscriptViewportEffectBase & {
			type: "ApplyScrollOffset";
			offsetPx: number;
			reason: "anchor-missing" | "fallback-recovery";
	  })
	| (TranscriptViewportEffectBase & {
			type: "SwitchRenderer";
			renderer: "primary" | "fallback";
			reason?: TranscriptRendererFallbackReason;
	  })
	| (TranscriptViewportEffectBase & {
			type: "ProbeRendererHealth";
	  })
	| (TranscriptViewportEffectBase & {
			type: "ReportDiagnostic";
			code:
				| "stale-event-dropped"
				| "anchor-missing"
				| "effect-skipped"
				| "renderer-health";
			message: string;
	  });

export function getTranscriptViewportEffectName(effect: TranscriptViewportEffect): string {
	return effect.type;
}
