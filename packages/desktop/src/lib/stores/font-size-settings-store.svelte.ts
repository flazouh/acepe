/**
 * Font Size Settings Store - controls the interface (root) font size and the
 * code/diff font size, applies them live to the document, and persists them.
 *
 * - UI font size sets the document root font-size in px, which proportionally
 *   scales rem-based interface typography and spacing (default 16 = no change).
 * - Code font size sets the `--code-font-size` CSS variable in px, consumed by
 *   code/diff surfaces in app.css. It is px-based so it stays independent of the
 *   UI scale.
 */

import { toast } from "svelte-sonner";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

const UI_FONT_SIZE_KEY: UserSettingKey = "ui_font_size";
const CODE_FONT_SIZE_KEY: UserSettingKey = "code_font_size";

const CODE_FONT_SIZE_VAR = "--code-font-size";

export const UI_FONT_SIZE = {
	DEFAULT: 16,
	MIN: 12,
	MAX: 20,
	STEP: 1,
} as const;

export const CODE_FONT_SIZE = {
	DEFAULT: 13,
	MIN: 10,
	MAX: 18,
	STEP: 1,
} as const;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function parsePx(value: string | null, fallback: number, min: number, max: number): number {
	if (value === null) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return fallback;
	}
	return clamp(parsed, min, max);
}

class FontSizeSettingsStore {
	uiFontSize = $state<number>(UI_FONT_SIZE.DEFAULT);
	codeFontSize = $state<number>(CODE_FONT_SIZE.DEFAULT);

	readonly uiBounds = UI_FONT_SIZE;
	readonly codeBounds = CODE_FONT_SIZE;

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}
		this.initialized = true;

		const [uiResult, codeResult] = await Promise.all([
			settings.getRaw(UI_FONT_SIZE_KEY),
			settings.getRaw(CODE_FONT_SIZE_KEY),
		]);

		if (uiResult.isOk()) {
			this.applyUiFontSize(
				parsePx(uiResult.value, UI_FONT_SIZE.DEFAULT, UI_FONT_SIZE.MIN, UI_FONT_SIZE.MAX)
			);
		} else {
			this.applyUiFontSize(UI_FONT_SIZE.DEFAULT);
		}

		if (codeResult.isOk()) {
			this.applyCodeFontSize(
				parsePx(codeResult.value, CODE_FONT_SIZE.DEFAULT, CODE_FONT_SIZE.MIN, CODE_FONT_SIZE.MAX)
			);
		} else {
			this.applyCodeFontSize(CODE_FONT_SIZE.DEFAULT);
		}
	}

	async setUiFontSize(value: number): Promise<void> {
		const clamped = clamp(Math.round(value), UI_FONT_SIZE.MIN, UI_FONT_SIZE.MAX);
		if (clamped === this.uiFontSize) {
			return;
		}
		this.applyUiFontSize(clamped);

		const result = await settings.setRaw(UI_FONT_SIZE_KEY, String(clamped));
		if (result.isErr()) {
			toast.error(`Failed to save interface font size: ${result.error.message}`);
		}
	}

	async setCodeFontSize(value: number): Promise<void> {
		const clamped = clamp(Math.round(value), CODE_FONT_SIZE.MIN, CODE_FONT_SIZE.MAX);
		if (clamped === this.codeFontSize) {
			return;
		}
		this.applyCodeFontSize(clamped);

		const result = await settings.setRaw(CODE_FONT_SIZE_KEY, String(clamped));
		if (result.isErr()) {
			toast.error(`Failed to save code font size: ${result.error.message}`);
		}
	}

	private applyUiFontSize(value: number): void {
		this.uiFontSize = value;
		if (typeof document !== "undefined") {
			document.documentElement.style.fontSize = `${value}px`;
		}
	}

	private applyCodeFontSize(value: number): void {
		this.codeFontSize = value;
		if (typeof document !== "undefined") {
			document.documentElement.style.setProperty(CODE_FONT_SIZE_VAR, `${value}px`);
		}
	}
}

export const fontSizeSettingsStore = new FontSizeSettingsStore();
