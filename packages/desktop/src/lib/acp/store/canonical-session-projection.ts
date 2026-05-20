import type {
	AssistantTextDeltaPayload,
	ActiveStreamingTail,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionTurnState,
} from "../../services/acp-types.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";

export type SessionClockAnchor = {
	readonly rustMonotonicMs: AssistantTextDeltaPayload["producedAtMonotonicMs"];
	readonly browserAnchorMs: number;
};

export type RowTokenStream = {
	readonly turnId: AssistantTextDeltaPayload["turnId"];
	readonly rowId: AssistantTextDeltaPayload["rowId"];
	readonly accumulatedText: string;
	readonly wordCount: number;
	readonly latestWordCount: number;
	readonly firstDeltaProducedAtMonotonicMs: AssistantTextDeltaPayload["producedAtMonotonicMs"];
	readonly lastDeltaProducedAtMonotonicMs: AssistantTextDeltaPayload["producedAtMonotonicMs"];
	readonly revision: AssistantTextDeltaPayload["revision"];
};

export type CanonicalSessionProjection = {
	readonly lifecycle: SessionGraphLifecycle;
	readonly activity: SessionGraphActivity;
	readonly turnState: SessionTurnState;
	readonly activeTurnFailure: ActiveTurnFailure | null;
	readonly lastTerminalTurnId: string | null;
	readonly activeStreamingTail: ActiveStreamingTail | null;
	readonly capabilities: SessionGraphCapabilities;
	readonly tokenStream: ReadonlyMap<string, RowTokenStream>;
	readonly clockAnchor: SessionClockAnchor | null;
	readonly revision: SessionGraphRevision;
};
