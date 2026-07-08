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
  --acepe-diff-separator-bg: color-mix(in srgb, var(--background) 72%, var(--accent) 28%);
  --acepe-diff-separator-border: color-mix(in srgb, var(--border) 82%, transparent);
  --acepe-diff-separator-control-bg: color-mix(in srgb, var(--card) 78%, var(--accent) 22%);
  --acepe-diff-separator-control-border: color-mix(in srgb, var(--border) 90%, transparent);
  --acepe-diff-separator-control-hover-bg: color-mix(in srgb, var(--accent) 72%, var(--card) 28%);
  --acepe-diff-separator-control-hover-border: color-mix(in srgb, var(--foreground) 14%, var(--border) 86%);
  --acepe-diff-separator-fg: color-mix(in srgb, var(--muted-foreground) 76%, transparent);
  --acepe-diff-separator-icon-fg: color-mix(in srgb, var(--muted-foreground) 66%, transparent);
  --acepe-diff-expand-icon: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2020%2020%27%3E%3Cpath%20fill%3D%27black%27%20d%3D%27M16.0299%203.0293C16.2896%202.76996%2016.7107%202.76988%2016.9703%203.0293C17.23%203.28899%2017.23%203.711%2016.9703%203.9707L13.2731%207.66797H16.9996L17.1344%207.68164C17.4372%207.74375%2017.6645%208.01192%2017.6647%208.33301C17.6647%208.65421%2017.4372%208.92219%2017.1344%208.98438L16.9996%208.99805H11.6666C11.2994%208.99801%2011.0016%208.70026%2011.0016%208.33301V3C11.0016%202.63275%2011.2994%202.33499%2011.6666%202.33496C12.0339%202.33496%2012.3317%202.63273%2012.3317%203V6.72754L16.0299%203.0293ZM8.99475%2017C8.99475%2017.3673%208.69698%2017.665%208.32971%2017.665C7.96258%2017.6649%207.66467%2017.3672%207.66467%2017V13.2725L3.96741%2016.9707C3.70771%2017.2304%203.2857%2017.2304%203.026%2016.9707C2.7663%2016.711%202.7663%2016.289%203.026%2016.0293L6.72424%2012.332H2.9967C2.62955%2012.332%202.33185%2012.0341%202.33167%2011.667C2.33167%2011.2997%202.62943%2011.002%202.9967%2011.002H8.32971C8.69698%2011.002%208.99475%2011.2997%208.99475%2011.667V17Z%27%2F%3E%3C%2Fsvg%3E");
  --acepe-diff-collapse-icon: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2020%2020%27%3E%3Cpath%20fill%3D%27black%27%20d%3D%27M4.33496%2011C4.33496%2010.6327%204.63273%2010.335%205%2010.335C5.36727%2010.335%205.66504%2010.6327%205.66504%2011V14.335H9L9.13379%2014.3486C9.43692%2014.4106%209.66504%2014.6786%209.66504%2015C9.66504%2015.3214%209.43692%2015.5894%209.13379%2015.6514L9%2015.665H5C4.63273%2015.665%204.33496%2015.3673%204.33496%2015V11ZM14.335%209V5.66504H11C10.6327%205.66504%2010.335%205.36727%2010.335%205C10.335%204.63273%2010.6327%204.33496%2011%204.33496H15L15.1338%204.34863C15.4369%204.41057%2015.665%204.67857%2015.665%205V9C15.665%209.36727%2015.3673%209.66504%2015%209.66504C14.6327%209.66504%2014.335%209.36727%2014.335%209Z%27%2F%3E%3C%2Fsvg%3E");
  --acepe-diff-chevron-up-icon: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%3E%3Cpath%20fill%3D%27black%27%20d%3D%27M8.35179%205.001L13.8178%2010.466C13.876%2010.524%2013.9222%2010.5929%2013.9537%2010.6688C13.9852%2010.7447%2014.0013%2010.826%2014.0012%2010.9082C14.0011%2010.9904%2013.9848%2011.0717%2013.9531%2011.1475C13.9215%2011.2234%2013.8751%2011.2922%2013.8168%2011.35C13.6991%2011.4668%2013.5401%2011.5324%2013.3743%2011.5324C13.2085%2011.5324%2013.0494%2011.4668%2012.9318%2011.35L7.99879%206.416L3.06679%2011.349C2.94842%2011.4614%202.79085%2011.5231%202.62765%2011.521C2.46445%2011.5189%202.30853%2011.4531%202.19312%2011.3377C2.07771%2011.2223%202.01193%2011.0663%202.00982%2010.9031C2.0077%2010.7399%202.06941%2010.5824%202.18179%2010.464L7.64779%205L8.35179%205.001Z%27%2F%3E%3C%2Fsvg%3E");
  --acepe-diff-chevron-down-icon: url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%3E%3Cpath%20fill%3D%27black%27%20d%3D%27M8.35176%2010.9989L13.8178%205.53391C13.876%205.47594%2013.9222%205.40702%2013.9537%205.33113C13.9851%205.25524%2014.0013%205.17387%2014.0012%205.0917C14.0011%205.00954%2013.9848%204.9282%2013.9531%204.85238C13.9215%204.77656%2013.8751%204.70775%2013.8168%204.64991C13.6991%204.53309%2013.5401%204.46753%2013.3743%204.46753C13.2085%204.46753%2013.0494%204.53309%2012.9318%204.64991L7.99776%209.58491L3.06776%204.65091C2.9494%204.53853%202.79183%204.47682%202.62863%204.47894C2.46542%204.48106%202.3095%204.54683%202.19409%204.66224C2.07868%204.77765%202.01291%204.93357%202.01079%205.09677C2.00868%205.25997%202.07039%205.41754%202.18276%205.53591L7.64776%2010.9999L8.35176%2010.9989Z%27%2F%3E%3C%2Fsvg%3E");
  --diffs-bg-separator-override: var(--acepe-diff-separator-bg);
  --diffs-fg-number-override: var(--acepe-diff-separator-fg);
}

[data-separator='line-info'] [data-separator-wrapper],
[data-separator='line-info-basic'] [data-separator-wrapper] {
  min-height: 24px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: var(--acepe-diff-separator-bg) !important;
  box-shadow:
    inset 0 1px var(--acepe-diff-separator-border),
    inset 0 -1px var(--acepe-diff-separator-border) !important;
  color: var(--acepe-diff-separator-fg) !important;
}

[data-separator='line-info'] [data-separator-content],
[data-separator='line-info-basic'] [data-separator-content] {
  min-height: 24px !important;
  padding-inline: 8px !important;
  font-size: 10px !important;
  line-height: 24px !important;
  letter-spacing: 0;
  color: var(--acepe-diff-separator-fg) !important;
}

[data-separator='line-info'] [data-unmodified-lines],
[data-separator='line-info-basic'] [data-unmodified-lines] {
  opacity: 0.85 !important;
}

[data-separator='line-info'] [data-expand-button],
[data-separator='line-info-basic'] [data-expand-button] {
  width: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  height: 24px !important;
  min-height: 24px !important;
  max-height: 24px !important;
  flex: 0 0 24px !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  border: 1px solid var(--acepe-diff-separator-control-border) !important;
  background-color: var(--acepe-diff-separator-control-bg) !important;
  color: var(--acepe-diff-separator-icon-fg) !important;
  fill: currentColor !important;
  border-radius: calc(var(--radius, 8px) - 4px) !important;
  box-shadow: inset 0 1px color-mix(in srgb, var(--foreground) 4%, transparent) !important;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease,
    color 120ms ease;
}

[data-separator='line-info'] [data-expand-button] > *,
[data-separator='line-info-basic'] [data-expand-button] > * {
  display: none !important;
}

[data-separator='line-info'] [data-expand-button]::before,
[data-separator='line-info-basic'] [data-expand-button]::before {
  content: "" !important;
  width: 13px !important;
  height: 13px !important;
  flex: 0 0 auto !important;
  background-color: currentColor !important;
  -webkit-mask-image: var(--acepe-diff-expand-icon);
  mask-image: var(--acepe-diff-expand-icon);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}

[data-separator='line-info'] [data-expand-button][aria-expanded='true']::before,
[data-separator='line-info-basic'] [data-expand-button][aria-expanded='true']::before {
  -webkit-mask-image: var(--acepe-diff-collapse-icon);
  mask-image: var(--acepe-diff-collapse-icon);
}

[data-separator='line-info'] [data-expand-button][data-expand-up]::before,
[data-separator='line-info-basic'] [data-expand-button][data-expand-up]::before {
  -webkit-mask-image: var(--acepe-diff-chevron-up-icon);
  mask-image: var(--acepe-diff-chevron-up-icon);
}

[data-separator='line-info'] [data-expand-button][data-expand-down]::before,
[data-separator='line-info-basic'] [data-expand-button][data-expand-down]::before {
  -webkit-mask-image: var(--acepe-diff-chevron-down-icon);
  mask-image: var(--acepe-diff-chevron-down-icon);
}

[data-separator='line-info'] [data-expand-button]:hover,
[data-separator='line-info-basic'] [data-expand-button]:hover {
  border-color: var(--acepe-diff-separator-control-hover-border) !important;
  background-color: var(--acepe-diff-separator-control-hover-bg) !important;
  box-shadow:
    inset 0 1px color-mix(in srgb, var(--foreground) 7%, transparent),
    0 1px 1px color-mix(in srgb, #000 18%, transparent) !important;
  color: var(--foreground) !important;
}

[data-separator='line-info'] [data-expand-button]:focus-visible,
[data-separator='line-info-basic'] [data-expand-button]:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ring) 55%, transparent) !important;
  outline-offset: -2px !important;
}

[data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-up] {
  border-right: 1px solid var(--acepe-diff-separator-control-border) !important;
  border-bottom: 1px solid var(--acepe-diff-separator-control-border) !important;
}

[data-separator='line-info'] [data-separator-wrapper][data-separator-multi-button] [data-expand-down] {
  border-right: 1px solid var(--acepe-diff-separator-control-border) !important;
}

[data-gutter] [data-separator='line-info'] [data-separator-wrapper] {
  background-color: var(--acepe-diff-separator-bg) !important;
}

[data-gutter] [data-separator='line-info'] [data-expand-button] {
  background-color: var(--acepe-diff-separator-control-bg) !important;
}

[data-gutter] [data-separator='line-info'] [data-expand-button]:hover {
  background-color: var(--acepe-diff-separator-control-hover-bg) !important;
}

[data-diff-type='split'] [data-separator='line-info'],
[data-diff-type='split'] [data-separator='line-info-basic'] {
  background-color: var(--acepe-diff-separator-bg) !important;
  box-shadow:
    inset 0 1px var(--acepe-diff-separator-border),
    inset 0 -1px var(--acepe-diff-separator-border) !important;
}

[data-diff-type='split'] [data-content] [data-separator-wrapper] {
  display: none !important;
}

[data-diff-type='split'] [data-gutter] [data-separator-wrapper] {
  display: flex !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  padding-block: 3px !important;
  box-sizing: border-box !important;
  align-items: center !important;
  justify-content: center !important;
  grid-template-columns: none !important;
}

[data-diff-type='split'] [data-gutter] [data-separator-content] {
  display: none !important;
}

[data-diff-type='split'] [data-gutter] [data-expand-button] {
  width: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  height: 24px !important;
  min-height: 24px !important;
  max-height: 24px !important;
  flex: 0 0 24px !important;
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
