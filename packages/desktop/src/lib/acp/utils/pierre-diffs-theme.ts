import { registerCustomTheme, type ThemeRegistrationResolved } from "@pierre/diffs";
import { err, ok, type Result } from "neverthrow";
import type { ThemeRegistration } from "shiki";

import { getCursorThemeName, loadCursorTheme } from "./shiki-theme.js";

/**
 * Custom CSS injected into @pierre/diffs shadow DOM.
 * Removes the top padding gap while keeping enough bottom space for the final
 * line to scroll clear of overlay scrollbars.
 */
export const pierreDiffsUnsafeCSS = `
[data-code] {
  --diffs-gap-block: 0;
  --diffs-gap-fallback: 0;
  font-size: 12px;
  padding-top: 0 !important;
	padding-bottom: 8px !important;
}

[data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-addition-color-override: light-dark(#22c55e, #A3BE8C);
  --diffs-deletion-color-override: light-dark(#ef4444, #BF616A);
  --diffs-modified-color-override: light-dark(#3b82f6, #EBCB8B);
  --diffs-bg-separator-override: light-dark(#fafafa, #27272a);
  --diffs-fg-number-override: light-dark(#71717a, #a1a1aa);
}

[data-separator='line-info'] [data-separator-wrapper],
[data-separator='line-info-basic'] [data-separator-wrapper] {
  min-height: 12px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: light-dark(#fafafa, #27272a) !important;
  color: light-dark(#71717a, #a1a1aa) !important;
}

[data-separator='line-info'] [data-separator-content],
[data-separator='line-info-basic'] [data-separator-content] {
  min-height: 12px !important;
  padding-inline: 3px 5px !important;
  font-size: 10px !important;
  line-height: 12px !important;
  letter-spacing: 0;
  color: light-dark(#71717a, #a1a1aa) !important;
}

[data-separator='line-info'] [data-unmodified-lines],
[data-separator='line-info-basic'] [data-unmodified-lines] {
  opacity: 0.85 !important;
}

[data-separator='line-info'] [data-expand-button],
[data-separator='line-info-basic'] [data-expand-button] {
  width: 14px !important;
  min-height: 12px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background-color: light-dark(#f4f4f5, #2f2f35) !important;
  color: light-dark(#71717a, #a1a1aa) !important;
  fill: currentColor !important;
  border-radius: 0 !important;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

[data-separator='line-info'] [data-expand-button]:hover,
[data-separator='line-info-basic'] [data-expand-button]:hover {
  background-color: light-dark(#e4e4e7, #3f3f46) !important;
  color: light-dark(#3f3f46, #d4d4d8) !important;
}

[data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-up] {
  border-right: 0 !important;
  border-bottom: 0 !important;
}

[data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-down] {
  border-right: 0 !important;
}

[data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
  background-color: light-dark(#fafafa, #27272a) !important;
}

[data-gutter] [data-separator='line-info'] [data-expand-button] {
  background-color: light-dark(#f4f4f5, #2f2f35) !important;
}

[data-gutter] [data-separator='line-info'] [data-expand-button]:hover {
  background-color: light-dark(#e4e4e7, #3f3f46) !important;
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
