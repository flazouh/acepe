/**
 * Base error class for all ACP-related errors.
 *
 * All ACP errors extend this class to provide consistent error handling
 * and enable proper error type checking with neverthrow.
 *
 * @example
 * ```typescript
 * throw new AcpError('Connection failed', 'CONNECTION_ERROR', cause);
 * ```
 */
export class AcpError extends Error {
	/**
	 * Creates a new AcpError instance.
	 *
	 * @param message - Human-readable error message
	 * @param code - Error code for programmatic error handling
	 * @param cause - Optional underlying error that caused this error
	 */
	constructor(
		message: string,
		public readonly code: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = "AcpError";

		// Maintains proper stack trace for where our error was thrown (only available on V8)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, AcpError);
		}
	}

	/**
	 * Returns a string representation of the error.
	 *
	 * @returns Formatted error string with code and message
	 */
	override toString(): string {
		return `[${this.code}] ${this.message}`;
	}
}

export type AcpCreationFailureKind =
	| "provider_failed_before_id"
	| "invalid_provider_session_id"
	| "provider_identity_mismatch"
	| "metadata_commit_failed"
	| "launch_token_unavailable"
	| "creation_attempt_expired";

export class CreationFailedAcpError extends AcpError {
	constructor(
		message: string,
		readonly kind: AcpCreationFailureKind,
		readonly sessionId: string | null,
		readonly creationAttemptId: string | null,
		readonly retryable: boolean
	) {
		super(message, `CREATION_FAILED:${kind}`);
		this.name = "CreationFailedAcpError";
	}
}

export type ProviderHistoryFailureKind =
	| "provider_unavailable"
	| "provider_history_missing"
	| "provider_unparseable"
	| "provider_validation_failed"
	| "stale_lineage_recovery"
	| "internal";

export class ProviderHistoryFailedAcpError extends AcpError {
	constructor(
		message: string,
		readonly kind: ProviderHistoryFailureKind,
		readonly sessionId: string | null,
		readonly retryable: boolean
	) {
		super(message, `PROVIDER_HISTORY_FAILED:${kind}`);
		this.name = "ProviderHistoryFailedAcpError";
	}
}

/**
 * Raised when a transcript viewport command targets a session whose canonical
 * viewport state is absent from the current backend runtime (e.g. after a backend
 * restart wiped the in-memory registries while the frontend kept the session open).
 *
 * This is a recoverable signal: the frontend should re-attach the session rather
 * than treat it as a hard failure.
 */
export class ViewportSessionNotAttachedAcpError extends AcpError {
	constructor(readonly sessionId: string) {
		super(
			`No canonical transcript viewport is attached for session ${sessionId}`,
			"VIEWPORT_SESSION_NOT_ATTACHED"
		);
		this.name = "ViewportSessionNotAttachedAcpError";
	}
}
