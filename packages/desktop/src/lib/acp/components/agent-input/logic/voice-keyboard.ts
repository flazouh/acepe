export interface VoiceKeyboardEventLike {
	altKey: boolean;
	code: string;
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	repeat?: boolean;
	shiftKey: boolean;
}

function isRightOption(event: VoiceKeyboardEventLike): boolean {
	return event.code === "AltRight" && !event.shiftKey && !event.metaKey && !event.ctrlKey;
}

export function shouldStartVoiceHold(event: VoiceKeyboardEventLike): boolean {
	if (!isRightOption(event)) {
		return false;
	}

	return event.repeat !== true;
}

export function shouldStopVoiceHold(
	event: VoiceKeyboardEventLike,
	isPressAndHold: boolean
): boolean {
	if (!isPressAndHold) {
		return false;
	}

	return isRightOption(event);
}

export function shouldRouteWindowVoiceHold(params: {
	editorHasFocus: boolean;
	focusedPanelId: string | null;
	panelId?: string;
}): boolean {
	if (params.editorHasFocus) {
		return false;
	}

	if (!params.panelId) {
		return true;
	}

	return params.panelId === params.focusedPanelId;
}
