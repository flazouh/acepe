import type { RpcProjectedSetting, UserSettingKey } from "@acepe/contracts";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

export const CODE_FONT_SIZE_VAR = "--code-font-size";

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

export type FontSizeBounds = {
	readonly DEFAULT: number;
	readonly MIN: number;
	readonly MAX: number;
	readonly STEP: number;
};

export type FontSizeRoot = {
	readonly style: {
		fontSize: string;
		readonly setProperty: (name: string, value: string) => void;
	};
};

const clamp = (value: number, min: number, max: number): number => {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
};

export const parseSettingPx = (value: string | undefined, bounds: FontSizeBounds): number => {
	if (value === undefined) {
		return bounds.DEFAULT;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return bounds.DEFAULT;
	}
	return clamp(parsed, bounds.MIN, bounds.MAX);
};

const valueForKey = (
	rows: ReadonlyArray<RpcProjectedSetting>,
	key: UserSettingKey,
): string | undefined => {
	const found = Arr.findFirst(rows, (row) => row.key === key);
	if (Option.isNone(found)) {
		return undefined;
	}
	return found.value.value;
};

export const uiFontSizeFromSettings = (rows: ReadonlyArray<RpcProjectedSetting>): number =>
	parseSettingPx(valueForKey(rows, "ui_font_size"), UI_FONT_SIZE);

export const codeFontSizeFromSettings = (rows: ReadonlyArray<RpcProjectedSetting>): number =>
	parseSettingPx(valueForKey(rows, "code_font_size"), CODE_FONT_SIZE);

export const applyFontSizeToRoot = (input: {
	readonly root: FontSizeRoot;
	readonly uiFontSize: number;
	readonly codeFontSize: number;
}): void => {
	input.root.style.fontSize = `${input.uiFontSize}px`;
	input.root.style.setProperty(CODE_FONT_SIZE_VAR, `${input.codeFontSize}px`);
};

export const nextFontSize = (current: number, delta: number, bounds: FontSizeBounds): number =>
	clamp(current + delta, bounds.MIN, bounds.MAX);
