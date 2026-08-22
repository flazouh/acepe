import type { RpcSessionSnapshot } from "@acepe/contracts";
import type { SettingsModalViewModel } from "@acepe/ui/settings-modal";

import { CODE_FONT_SIZE, codeFontSizeFromSettings, UI_FONT_SIZE, uiFontSizeFromSettings } from "./settings-font.ts";

export const SETTINGS_MODAL_COPY = {
	openLabel: "Settings",
	closeLabel: "Close",
	title: "Appearance",
	uiFontLabel: "Interface font size",
	uiFontDescription: "Base font size for the app. Scales menus, panels, and the review modal.",
	codeFontLabel: "Code font size",
	codeFontDescription: "Font size for code blocks and diffs.",
	reviewPreviewLabel: "Review modal",
	reviewPreviewText: "Review this change",
	diffPreviewLabel: "Diff",
	diffPreviewText: "+ persisted setting",
} as const;

export const settingsModalViewModel = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly open: boolean;
}): SettingsModalViewModel => ({
	openLabel: SETTINGS_MODAL_COPY.openLabel,
	closeLabel: SETTINGS_MODAL_COPY.closeLabel,
	title: SETTINGS_MODAL_COPY.title,
	uiFontLabel: SETTINGS_MODAL_COPY.uiFontLabel,
	uiFontDescription: SETTINGS_MODAL_COPY.uiFontDescription,
	codeFontLabel: SETTINGS_MODAL_COPY.codeFontLabel,
	codeFontDescription: SETTINGS_MODAL_COPY.codeFontDescription,
	reviewPreviewLabel: SETTINGS_MODAL_COPY.reviewPreviewLabel,
	reviewPreviewText: SETTINGS_MODAL_COPY.reviewPreviewText,
	diffPreviewLabel: SETTINGS_MODAL_COPY.diffPreviewLabel,
	diffPreviewText: SETTINGS_MODAL_COPY.diffPreviewText,
	open: input.open,
	uiFontSize: uiFontSizeFromSettings(input.snapshot.settings),
	codeFontSize: codeFontSizeFromSettings(input.snapshot.settings),
	uiMin: UI_FONT_SIZE.MIN,
	uiMax: UI_FONT_SIZE.MAX,
	codeMin: CODE_FONT_SIZE.MIN,
	codeMax: CODE_FONT_SIZE.MAX,
});
