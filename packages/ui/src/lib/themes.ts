/**
 * The theme families shipped in theme.css.
 *
 * This list is what UI renders in a picker. theme.css is what the browser
 * paints. `themes.test.ts` fails when the two disagree, so a family can never
 * appear in a menu without a stylesheet behind it.
 */

export const UI_THEME_ATTRIBUTE = "data-ui-theme";

export interface UiThemeFamily {
	readonly id: string;
	/** Shown in the picker. */
	readonly label: string;
	/** One line on where the palette comes from. */
	readonly origin: string;
}

export const uiThemeFamilies: readonly UiThemeFamily[] = [
	{
		id: "acepe",
		label: "Acepe",
		origin: "The default. Warm dark, Codex-derived light.",
	},
	{
		id: "anthropic",
		label: "Anthropic",
		origin: "Acepe's surfaces with the terracotta brand accent.",
	},
	{
		id: "cursor",
		label: "Cursor",
		origin: "Cursor's own editor themes, light and dark.",
	},
	{
		id: "one",
		label: "One",
		origin: "Atom's One Light and One Dark.",
	},
];

export const DEFAULT_UI_THEME = "acepe";

export type UiThemeId = (typeof uiThemeFamilies)[number]["id"];

export function isUiThemeId(
	value: string | null | undefined,
): value is UiThemeId {
	return uiThemeFamilies.some((family) => family.id === value);
}

/** Falls back to the default rather than leaving the app unstyled. */
export function resolveUiThemeId(value: string | null | undefined): UiThemeId {
	return isUiThemeId(value) ? value : DEFAULT_UI_THEME;
}

/** Write the family onto the document. Appearance stays on the `dark` class. */
export function applyUiThemeToDocument(
	id: string,
	root: HTMLElement,
): UiThemeId {
	const resolved = resolveUiThemeId(id);
	root.setAttribute(UI_THEME_ATTRIBUTE, resolved);
	return resolved;
}
