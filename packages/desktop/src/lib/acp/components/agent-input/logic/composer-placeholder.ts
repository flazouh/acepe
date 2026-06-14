const DEFAULT_COMPOSER_PLACEHOLDER = "Plan, @ for context, / for commands";
const FOLLOW_UP_COMPOSER_PLACEHOLDER = "Send follow-up";

interface ResolveComposerPlaceholderInput {
	readonly hasSession: boolean;
	readonly fallback?: string;
}

export function resolveComposerPlaceholder(input: ResolveComposerPlaceholderInput): string {
	if (input.hasSession) {
		return FOLLOW_UP_COMPOSER_PLACEHOLDER;
	}

	return input.fallback ?? DEFAULT_COMPOSER_PLACEHOLDER;
}
