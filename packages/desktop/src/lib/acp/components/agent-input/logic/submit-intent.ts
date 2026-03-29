export type SubmitIntent = "none" | "send" | "steer" | "cancel";

interface EnterKeyIntentInput {
	hasDraftInput: boolean;
	isAgentBusy: boolean;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}

interface PrimaryButtonIntentInput {
	hasDraftInput: boolean;
	isAgentBusy: boolean;
	isStreaming: boolean;
	isShiftPressed: boolean;
}

export function resolveEnterKeyIntent(input: EnterKeyIntentInput): SubmitIntent {
	if (!input.hasDraftInput) {
		return "none";
	}

	if ((input.metaKey || input.ctrlKey) && !input.shiftKey) {
		return "steer";
	}

	if (input.shiftKey) {
		return input.isAgentBusy ? "steer" : "none";
	}

	return "send";
}

export function resolvePrimaryButtonIntent(input: PrimaryButtonIntentInput): SubmitIntent {
	if (input.isStreaming && !input.hasDraftInput) {
		return "cancel";
	}

	if (!input.hasDraftInput) {
		return "none";
	}

	if (input.isAgentBusy && input.isShiftPressed) {
		return "steer";
	}

	return "send";
}
