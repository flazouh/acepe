import { getContext, setContext } from "svelte";

const THINKING_PREFERENCES_KEY = Symbol("thinking-preferences");

interface ThinkingPreferences {
	/** Whether thinking blocks are expanded by default */
	defaultExpanded: boolean;
	/** Toggle the default expand preference */
	onToggleDefaultExpand: () => void;
}

export function setThinkingPreferences(prefs: ThinkingPreferences): void {
	setContext(THINKING_PREFERENCES_KEY, prefs);
}

export function getThinkingPreferences(): ThinkingPreferences | undefined {
	try {
		return getContext<ThinkingPreferences | undefined>(THINKING_PREFERENCES_KEY);
	} catch {
		return undefined;
	}
}
