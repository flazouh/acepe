import { getContext, setContext } from "svelte";

const DROPDOWN_MENU_HIGHLIGHT_KEY = Symbol("dropdown-menu-highlight");

export type DropdownMenuHighlightContext = {
	attachItem: (element: HTMLElement) => () => void;
};

export function setDropdownMenuHighlightContext(
	context: DropdownMenuHighlightContext,
): void {
	setContext(DROPDOWN_MENU_HIGHLIGHT_KEY, context);
}

export function getDropdownMenuHighlightContext():
	| DropdownMenuHighlightContext
	| undefined {
	return getContext<DropdownMenuHighlightContext | undefined>(
		DROPDOWN_MENU_HIGHLIGHT_KEY,
	);
}
