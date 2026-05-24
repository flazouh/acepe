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
			offsetPx: number;
	  })
	| (TranscriptViewportEffectBase & {
			type: "ApplyScrollOffset";
			offsetPx: number;
			reason: "anchor-missing" | "preserve-anchor";
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
