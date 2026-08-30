import type { SessionStateGraph } from "../../../services/acp-types.js";
import type { SessionCold } from "../../application/dto/session-cold.js";
import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import type { SessionTransientProjection } from "../types.js";

export type EnvelopeReducerSnapshot = {
	readonly sessionId: string;
	readonly hasSessionIdentity: boolean;
	/** The session is an optimistic row whose creation the backend has not confirmed. */
	readonly hasPendingCreation: boolean;
	readonly previousProjection: CanonicalSessionProjection | null;
	readonly previousGraph: SessionStateGraph | null;
	readonly capabilitiesMaterialized: boolean;
	readonly transientProjection: SessionTransientProjection;
	readonly currentModelId: string | null;
	readonly sessionCold: SessionCold | undefined;
};
