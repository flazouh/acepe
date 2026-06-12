import type { AvailableMode } from "../../../types/available-mode.js";

const DEFAULT_COMPOSER_PLACEHOLDER = "Plan, @ for context, / for commands";

interface ResolveComposerPlaceholderInput {
	readonly modes: readonly AvailableMode[];
	readonly currentModeId: string | null;
	readonly fallback?: string;
}

export function resolveComposerPlaceholder(input: ResolveComposerPlaceholderInput): string {
	const fallback = input.fallback ?? DEFAULT_COMPOSER_PLACEHOLDER;
	if (!input.currentModeId) {
		return fallback;
	}

	const currentMode = input.modes.find((mode) => mode.id === input.currentModeId);
	if (!currentMode) {
		return fallback;
	}

	if (currentMode.description && currentMode.description.trim().length > 0) {
		return currentMode.description.trim();
	}

	return fallback;
}
