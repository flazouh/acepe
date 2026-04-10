export type SubmitIntent = "none" | "send" | "steer" | "cancel";
export type DefaultSubmitAction = "none" | "send" | "queue" | "steer";

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

interface DefaultSubmitActionInput {
	hasDraftInput: boolean;
	hasSessionId: boolean;
	isAgentBusy: boolean;
	isStreaming: boolean;
	isSubmitDisabled: boolean;
}

interface PrimaryButtonDisabledInput {
	hasDraftInput: boolean;
	isSending: boolean;
	isAgentBusy: boolean;
	isSubmitDisabled: boolean;
	primaryButtonIntent: SubmitIntent;
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

export function resolveDefaultSubmitAction(input: DefaultSubmitActionInput): DefaultSubmitAction {
	if (!input.hasDraftInput) {
		return "none";
	}

	if (input.hasSessionId && input.isAgentBusy) {
		return "queue";
	}

	if (input.hasSessionId && input.isStreaming) {
		return "steer";
	}

	if (input.isSubmitDisabled) {
		return "none";
	}

	return "send";
}

export function isPrimaryButtonDisabled(input: PrimaryButtonDisabledInput): boolean {
	if (input.isSending) {
		return true;
	}

	if (input.primaryButtonIntent === "cancel") {
		return false;
	}

	if (input.primaryButtonIntent === "none") {
		return true;
	}

	if (!input.hasDraftInput) {
		return true;
	}

	if (input.primaryButtonIntent === "steer") {
		return false;
	}

	if (input.isAgentBusy) {
		return false;
	}

	return input.isSubmitDisabled;
}
