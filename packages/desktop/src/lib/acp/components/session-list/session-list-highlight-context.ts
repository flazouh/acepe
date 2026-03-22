import { getContext, setContext } from "svelte";

const SESSION_LIST_HIGHLIGHT_KEY = Symbol("session-list-highlight");

export type SessionListHighlightContext = {
	updateHighlight: (element: HTMLElement | null) => void;
	clearHighlight: () => void;
};

export function setSessionListHighlightContext(context: SessionListHighlightContext): void {
	setContext(SESSION_LIST_HIGHLIGHT_KEY, context);
}

export function getSessionListHighlightContext(): SessionListHighlightContext | undefined {
	return getContext<SessionListHighlightContext | undefined>(SESSION_LIST_HIGHLIGHT_KEY);
}
