import type { VoiceInputPhase } from "../../../types/voice-input.js";

/** Valid state transitions. Key = current state, value = set of allowed next states. */
export const VALID_TRANSITIONS: Record<VoiceInputPhase, ReadonlySet<VoiceInputPhase>> = {
	idle: new Set<VoiceInputPhase>(["checking_permission"]),
	checking_permission: new Set<VoiceInputPhase>([
		"recording",
		"downloading_model",
		"loading_model",
		"cancelled",
		"error",
	]),
	downloading_model: new Set<VoiceInputPhase>(["loading_model", "error", "cancelled"]),
	loading_model: new Set<VoiceInputPhase>(["recording", "error", "cancelled"]),
	recording: new Set<VoiceInputPhase>(["transcribing", "cancelled", "error"]),
	transcribing: new Set<VoiceInputPhase>(["complete", "cancelled", "error"]),
	complete: new Set<VoiceInputPhase>(["idle"]),
	cancelled: new Set<VoiceInputPhase>(["idle"]),
	error: new Set<VoiceInputPhase>(["idle"]),
};

/**
 * Validate and execute a state transition. Returns the new state or null if invalid.
 * This is the single bottleneck for all guard logic.
 */
export function transition(
	current: VoiceInputPhase,
	next: VoiceInputPhase
): VoiceInputPhase | null {
	if (VALID_TRANSITIONS[current].has(next)) {
		return next;
	}
	console.warn(`[voice] BLOCKED transition: ${current} → ${next}`);
	return null;
}
