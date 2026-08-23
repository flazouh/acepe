import type { AppError } from "../../../errors/app-error.js";
import { getErrorCauseDetails } from "../../../errors/error-cause-details.js";

/**
 * Voice command failures (permission denied, no input device, an RPC
 * dispatch failure, ...) reach the UI wrapped inside a generic AgentError
 * whose own message only names the operation ("Agent operation failed:
 * voice.recording.start"). That wrapper hides the real cause from the user.
 *
 * Walk the error's cause chain and surface the deepest distinct message
 * instead, so the rendered error names what actually went wrong. Falls back
 * to the error's own message, then to the caller-provided default, so the
 * rendered text is never empty.
 */
export function resolveVoiceFailureMessage(err: AppError, fallback: string): string {
	const details = getErrorCauseDetails(err);
	if (details.rootCause !== null && details.rootCause.trim().length > 0) {
		return details.rootCause;
	}
	if (err.message.trim().length > 0) {
		return err.message;
	}
	return fallback;
}
