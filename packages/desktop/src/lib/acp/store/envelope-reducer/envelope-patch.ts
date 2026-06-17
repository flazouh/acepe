import type {
	AssistantTextDeltaPayload,
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TranscriptSnapshot,
	TurnFailureSnapshot,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../../services/acp-types.js";
import type { CanonicalSessionProjection, RowTokenStream } from "../canonical-session-projection.js";
import type { SessionTransientProjection, SessionUsageTelemetry } from "../types.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";

export type SessionStateSnapshotRefreshReason =
	| "transcriptFrontierMismatch"
	| "missingCanonicalProjection"
	| "missingCanonicalGraph"
	| "missingProjectionBeforeAssistantDelta";

export type EnvelopePatch =
	| {
			kind: "setCapabilitiesMaterialized";
			sessionId: string;
			materialized: boolean;
	  }
	| {
			kind: "setCanonicalProjection";
			sessionId: string;
			projection: CanonicalSessionProjection;
	  }
	| {
			kind: "setSessionStateGraph";
			sessionId: string;
			graph: SessionStateGraph;
	  }
	| {
			kind: "updateTransientProjection";
			sessionId: string;
			updates: {
				readonly [K in keyof SessionTransientProjection]?: SessionTransientProjection[K];
			};
	  }
	| {
			kind: "setUsageTelemetry";
			sessionId: string;
			telemetry: SessionUsageTelemetry;
	  }
	| {
			kind: "notifyPlanUpdate";
			sessionId: string;
			plan: PlanData;
	  }
	| {
			kind: "applyViewportBufferPush";
			push: ViewportBufferPush;
	  }
	| {
			kind: "applyViewportBufferDelta";
			delta: ViewportBufferDelta;
	  }
	| {
			kind: "replaceSessionOperations";
			sessionId: string;
			operations: OperationSnapshot[];
	  }
	| {
			kind: "replaceTranscriptSnapshot";
			sessionId: string;
			snapshot: TranscriptSnapshot;
			appliedAtMs: number;
	  }
	| {
			kind: "applyTranscriptDeltaToEntryStore";
			sessionId: string;
			delta: TranscriptDelta;
			appliedAtMs: number;
	  }
	| {
			kind: "applySessionOperationPatches";
			sessionId: string;
			patches: OperationSnapshot[];
	  }
	| {
			kind: "replaceLiveSessionStateGraph";
			graph: SessionStateGraph;
	  }
	| {
			kind: "applyLiveSessionInteractionPatches";
			snapshots: InteractionSnapshot[];
	  }
	| {
			kind: "applySessionStateGraph";
			graph: SessionStateGraph;
	  }
	| {
			kind: "syncAwaitingModelRefreshTimer";
			sessionId: string;
			activity: SessionGraphActivity;
			turnState: SessionTurnState;
	  }
	| {
			kind: "reconcileConnectionMachine";
			sessionId: string;
			lifecycle: SessionGraphLifecycle;
			turnState: SessionTurnState;
			activeTurnFailure: ActiveTurnFailure | null;
	  }
	| {
			kind: "invokeCanonicalTerminalTurnSideEffects";
			sessionId: string;
			previousProjection: CanonicalSessionProjection | null;
			turnState: SessionTurnState;
			activeTurnFailure: ActiveTurnFailure | null;
			projectedFailure: TurnFailureSnapshot | null;
			lastTerminalTurnId: string | null;
	  }
	| {
			kind: "refreshSessionStateSnapshot";
			sessionId: string;
			reason: SessionStateSnapshotRefreshReason;
			warnContext?: {
				readonly currentTranscriptRevision?: number;
				readonly fromRevision?: number;
				readonly toRevision?: number;
			};
	  }
	| {
			kind: "setRowTokenStream";
			sessionId: string;
			rowId: string;
			row: RowTokenStream;
	  }
	| {
			kind: "warnMissingCanonicalProjection";
			sessionId: string;
			reason: "graphPatches" | "assistantTextDelta";
			context: {
				readonly revision?: import("../../../services/acp-types.js").SessionGraphRevision;
				readonly turnId?: string;
				readonly rowId?: string;
				readonly deltaRevision?: number;
			};
	  };
