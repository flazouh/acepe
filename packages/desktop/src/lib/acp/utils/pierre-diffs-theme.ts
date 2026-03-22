import { registerCustomTheme, type ThemeRegistrationResolved } from "@pierre/diffs";
import { err, ok, type Result } from "neverthrow";
import type { ThemeRegistration } from "shiki";

import { getCursorThemeName, loadCursorTheme } from "./shiki-theme.js";

/**
 * Custom CSS injected into @pierre/diffs shadow DOM.
 * Removes padding gaps between header and first line of diff content.
 */
export const pierreDiffsUnsafeCSS = `
[data-code] {
  --diffs-gap-block: 0;
  --diffs-gap-fallback: 0;
  font-size: 12px;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
`;

let registrationPromise: Promise<void> | null = null;

/**
 * Type guard to validate that a theme is compatible with ThemeRegistrationResolved.
 * Checks for required properties that a resolved theme must have.
 */
function isThemeRegistrationResolved(theme: ThemeRegistration): theme is ThemeRegistrationResolved {
	return (
		typeof theme === "object" &&
		theme !== null &&
		"name" in theme &&
		typeof theme.name === "string" &&
		"colors" in theme &&
		typeof theme.colors === "object" &&
		theme.colors !== null &&
		(("tokenColors" in theme && Array.isArray(theme.tokenColors)) ||
			("settings" in theme && Array.isArray(theme.settings)))
	);
}

/**
 * Validates and converts a ThemeRegistration to ThemeRegistrationResolved.
 * Returns Ok with the theme if valid, or Err if validation fails.
 */
function validateAndConvertTheme(
	theme: ThemeRegistration
): Result<ThemeRegistrationResolved, Error> {
	if (!isThemeRegistrationResolved(theme)) {
		return err(
			new Error(
				`Theme validation failed: theme must have 'name' (string), 'colors' (object), and either 'tokenColors' or 'settings' (array)`
			)
		);
	}
	return ok(theme);
}

/**
 * Registers the Cursor Dark theme with @pierre/diffs.
 * This should be called before rendering any diffs.
 * Safe to call multiple times - will only register once.
 * Concurrent calls will wait for the same registration to complete.
 */
export async function registerCursorThemeForPierreDiffs(): Promise<void> {
	if (registrationPromise) {
		return registrationPromise;
	}

	registrationPromise = (async () => {
		const themeResult = await loadCursorTheme();
		if (themeResult.isErr()) {
			console.warn("Failed to load cursor theme for pierre/diffs:", themeResult.error);
			registrationPromise = null; // Reset on error to allow retry
			throw new Error(`Failed to load cursor theme: ${themeResult.error.message}`);
		}

		const theme = themeResult.value;
		const themeName = getCursorThemeName(theme);

		const validationResult = validateAndConvertTheme(theme);
		if (validationResult.isErr()) {
			console.error("Failed to process theme for pierre/diffs:", validationResult.error.message);
			registrationPromise = null; // Reset on error to allow retry
			throw validationResult.error; // Throw to reject the promise
		}

		registerCustomTheme(themeName, () => Promise.resolve(validationResult.value));
	})();

	return registrationPromise;
}
