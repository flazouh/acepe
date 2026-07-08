export function shouldShowNewThreadSetupContext(input: {
	readonly hasSession: boolean;
	readonly hasImmediatePendingSendIntent: boolean;
	readonly hasMessages: boolean;
}): boolean {
	return !input.hasSession && !input.hasImmediatePendingSendIntent && !input.hasMessages;
}
