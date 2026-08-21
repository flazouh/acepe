import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import type { ThemeRegistration } from "shiki";

export type { ThemeRegistration };

const THEME_NAME_DARK = "cursor-dark";
const THEME_NAME_LIGHT = "cursor-light";
const CURSOR_THEME_ASSET_PATH = "../../../../static/themes/cursor.theme.json";
const CURSOR_LIGHT_THEME_ASSET_PATH = "../../../../static/themes/cursor-light.theme.json";

let cursorDarkTheme: ThemeRegistration | null = null;
let cursorLightTheme: ThemeRegistration | null = null;

function loadThemeRegistration(
	assetPath: string,
	publicPath: string,
	errorPrefix: string
): Promise<ThemeRegistration> {
	if (typeof Bun !== "undefined") {
		return Bun.file(new URL(assetPath, import.meta.url)).json();
	}

	return fetch(publicPath).then(async (response) => {
		if (!response.ok) {
			throw new Error(`${errorPrefix}: ${response.statusText}`);
		}

		return response.json() as Promise<ThemeRegistration>;
	});
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Loads the Cursor Dark theme from assets directory.
 * This should be called before initializing any highlighter.
 */
export function loadCursorTheme(): Effect.Effect<ThemeRegistration, Error> {
	if (cursorDarkTheme) {
		return Effect.succeed(cursorDarkTheme);
	}

	return fromPromise(async () => {
		cursorDarkTheme = await loadThemeRegistration(
			CURSOR_THEME_ASSET_PATH,
			"/themes/cursor.theme.json",
			"Failed to load theme"
		);
		return cursorDarkTheme;
	}, toError);
}

/**
 * Loads the Cursor Light theme from assets directory.
 */
export function loadCursorLightTheme(): Effect.Effect<ThemeRegistration, Error> {
	if (cursorLightTheme) {
		return Effect.succeed(cursorLightTheme);
	}

	return fromPromise(async () => {
		cursorLightTheme = await loadThemeRegistration(
			CURSOR_LIGHT_THEME_ASSET_PATH,
			"/themes/cursor-light.theme.json",
			"Failed to load light theme"
		);
		return cursorLightTheme;
	}, toError);
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
