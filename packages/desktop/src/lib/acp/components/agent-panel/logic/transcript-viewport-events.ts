import type { TranscriptViewportRowSummary } from "./transcript-viewport-row-summary.js";

export type TranscriptRendererHealthFailureReason =
	| "zero_viewport"
	| "no_rendered_entries"
	| "adapter-anchor-missing"
	| "explicit-safety-mode";

export type TranscriptViewportMeasurement = {
	scrollOffset: number;
	scrollSize: number;
	viewportSize: number;
};

export type TranscriptViewportEventBase = {
	sessionId: string | null;
	generation?: number;
};

export type TranscriptViewportEvent =
	| {
			type: "SessionChanged";
			sessionId: string | null;
			previousSessionId: string | null;
	  }
	| (TranscriptViewportEventBase & {
			type: "RendererMounted";
	  })
	| (TranscriptViewportEventBase & {
			type: "RendererFailed";
			reason: TranscriptRendererHealthFailureReason;
	  })
	| (TranscriptViewportEventBase & {
			type: "RowsChanged";
			rows: TranscriptViewportRowSummary;
	  })
	| (TranscriptViewportEventBase & {
			type: "ScrollMeasured";
			measurement: TranscriptViewportMeasurement;
	  })
	| (TranscriptViewportEventBase & {
			type: "UserWheel";
			measurement: TranscriptViewportMeasurement;
			anchorKey?: string;
			anchorOffsetPx?: number;
	  })
	| (TranscriptViewportEventBase & {
			type: "UserScroll";
			measurement: TranscriptViewportMeasurement;
			anchorKey?: string;
			anchorOffsetPx?: number;
	  })
	| (TranscriptViewportEventBase & {
			type: "UserNavigationScroll";
			measurement: TranscriptViewportMeasurement;
			anchorKey?: string;
			anchorOffsetPx?: number;
	  })
	| (TranscriptViewportEventBase & {
			type: "PublicScrollCommand";
			command: "top" | "bottom" | "follow";
	  })
	| (TranscriptViewportEventBase & {
			type: "ExplicitRevealRequested";
			targetKey: string;
	  })
	| (TranscriptViewportEventBase & {
			type: "SendStarted";
			targetKey?: string;
	  })
	| (TranscriptViewportEventBase & {
			type: "PanelActivated";
			targetKey?: string;
	  })
	| (TranscriptViewportEventBase & {
			type: "RowResized";
			rowKey: string;
	  })
	| (TranscriptViewportEventBase & {
			type: "ViewportResized";
			measurement: TranscriptViewportMeasurement;
	  })
	| (TranscriptViewportEventBase & {
			type: "AdapterAnchorMissing";
			anchorKey: string;
			fallbackOffsetPx: number;
	  })
	| (TranscriptViewportEventBase & {
			type: "EffectApplied";
			effectType: string;
	  })
	| (TranscriptViewportEventBase & {
			type: "EffectSkipped";
			effectType: string;
			reason: "stale-generation" | "missing-adapter" | "missing-target";
	  })
	| (TranscriptViewportEventBase & {
			type: "RendererHealthProbeReported";
			healthy: boolean;
			reason?: TranscriptRendererHealthFailureReason;
	  });

function getTranscriptViewportEventPriority(event: TranscriptViewportEvent): number {
	switch (event.type) {
		case "SessionChanged":
		case "RendererMounted":
		case "RendererFailed":
			return 0;
		case "UserWheel":
		case "UserScroll":
		case "UserNavigationScroll":
		case "PublicScrollCommand":
		case "ExplicitRevealRequested":
		case "SendStarted":
		case "PanelActivated":
			return 1;
		case "RowsChanged":
		case "RowResized":
		case "ViewportResized":
		case "ScrollMeasured":
			return 2;
		case "AdapterAnchorMissing":
			return 3;
		case "EffectApplied":
		case "EffectSkipped":
		case "RendererHealthProbeReported":
			return 4;
	}
}

export function orderTranscriptViewportEvents(
	events: readonly TranscriptViewportEvent[]
): TranscriptViewportEvent[] {
	const indexed = events.map((event, index) => {
		return {
			event,
			index,
			priority: getTranscriptViewportEventPriority(event),
		};
	});
	indexed.sort((left, right) => {
		if (left.priority !== right.priority) {
			return left.priority - right.priority;
		}
		return left.index - right.index;
	});
	return indexed.map((entry) => entry.event);
}
