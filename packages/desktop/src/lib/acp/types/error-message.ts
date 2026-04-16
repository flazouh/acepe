import type {
	TurnErrorKind,
	TurnErrorSource,
} from "../../services/converted-session-types.js";

/**
 * Error message displayed inline in the conversation thread.
 * Used for transient errors like API failures, usage limits, etc.
 * These errors are not persisted to session history.
 */
export interface ErrorMessage {
	readonly content: string;
	readonly code?: string;
	readonly kind?: TurnErrorKind;
	readonly source?: TurnErrorSource;
	readonly referenceId?: string;
	readonly referenceSearchable?: boolean;
}
