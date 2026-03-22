import { okAsync, ResultAsync } from "neverthrow";
import type { ThemeRegistration } from "shiki";

export type { ThemeRegistration };

const THEME_NAME_DARK = "cursor-dark";
const THEME_NAME_LIGHT = "cursor-light";

let cursorDarkTheme: ThemeRegistration | null = null;
let cursorLightTheme: ThemeRegistration | null = null;

/**
 * Loads the Cursor Dark theme from assets directory.
 * This should be called before initializing any highlighter.
 */
export function loadCursorTheme(): ResultAsync<ThemeRegistration, Error> {
	if (cursorDarkTheme) {
		return okAsync(cursorDarkTheme);
	}

	return ResultAsync.fromPromise(
		(async () => {
			const response = await fetch("/themes/cursor.theme.json");
			if (!response.ok) {
				throw new Error(`Failed to load theme: ${response.statusText}`);
			}
			const theme = await response.json();
			cursorDarkTheme = theme as ThemeRegistration;
			return cursorDarkTheme;
		})(),
		(error) => (error instanceof Error ? error : new Error(String(error)))
	);
}

/**
 * Loads the Cursor Light theme from assets directory.
 */
export function loadCursorLightTheme(): ResultAsync<ThemeRegistration, Error> {
	if (cursorLightTheme) {
		return okAsync(cursorLightTheme);
	}

	return ResultAsync.fromPromise(
		(async () => {
			const response = await fetch("/themes/cursor-light.theme.json");
			if (!response.ok) {
				throw new Error(`Failed to load light theme: ${response.statusText}`);
			}
			const theme = await response.json();
			cursorLightTheme = theme as ThemeRegistration;
			return cursorLightTheme;
		})(),
		(error) => (error instanceof Error ? error : new Error(String(error)))
	);
}

/**
 * Gets the theme name to use with shiki.
 * Uses the theme's name property from the JSON file.
 */
export function getCursorThemeName(theme: ThemeRegistration): string {
	return theme.name || THEME_NAME_DARK;
}

/**
 * Gets the appropriate theme name constant.
 */
export function getThemeNameForMode(isDark: boolean): string {
	return isDark ? THEME_NAME_DARK : THEME_NAME_LIGHT;
}
