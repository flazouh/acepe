export type VoiceStateLifecycleAction = "noop" | "init" | "replace" | "dispose";

export function resolveVoiceStateLifecycle(
	currentSessionId: string | null,
	nextSessionId: string | null,
	voiceEnabled: boolean,
): VoiceStateLifecycleAction {
	const shouldHaveVoiceState = voiceEnabled && nextSessionId !== null;

	if (!shouldHaveVoiceState) {
		return currentSessionId === null ? "noop" : "dispose";
	}

	if (currentSessionId === nextSessionId) {
		return "noop";
	}

	return currentSessionId === null ? "init" : "replace";
}
