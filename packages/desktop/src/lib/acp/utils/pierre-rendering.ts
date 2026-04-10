import type { FileDiffOptions, FileOptions, ThemeTypes } from "@pierre/diffs";

import { pierreDiffsUnsafeCSS, registerCursorThemeForPierreDiffs } from "./pierre-diffs-theme.js";

let pierreThemeRegistrationPromise: Promise<void> | null = null;

function getPierreThemeNames(): { dark: "Cursor Dark"; light: "pierre-light" } {
	return {
		dark: "Cursor Dark",
		light: "pierre-light",
	};
}

export function ensurePierreThemeRegistered(): Promise<void> {
	if (pierreThemeRegistrationPromise !== null) {
		return pierreThemeRegistrationPromise;
	}

	pierreThemeRegistrationPromise = registerCursorThemeForPierreDiffs();
	return pierreThemeRegistrationPromise;
}

export function buildPierreFileOptions<LAnnotation>(
	themeType: ThemeTypes,
	overflow: "scroll" | "wrap",
	disableLineNumbers: boolean
): FileOptions<LAnnotation> {
	return {
		theme: getPierreThemeNames(),
		themeType,
		overflow,
		unsafeCSS: pierreDiffsUnsafeCSS,
		disableFileHeader: true,
		disableLineNumbers,
	};
}

export function buildPierreDiffOptions<LAnnotation>(
	themeType: ThemeTypes,
	diffStyle: "unified" | "split",
	overflow: "scroll" | "wrap",
	disableLineNumbers: boolean
): FileDiffOptions<LAnnotation> {
	return {
		theme: getPierreThemeNames(),
		themeType,
		diffStyle,
		disableFileHeader: true,
		hunkSeparators: "line-info",
		overflow,
		unsafeCSS: pierreDiffsUnsafeCSS,
		expandUnchanged: false,
		diffIndicators: "bars",
		lineDiffType: "word-alt",
		disableLineNumbers,
	};
}
