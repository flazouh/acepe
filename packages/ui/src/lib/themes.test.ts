import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { DEFAULT_UI_THEME, isUiThemeId, resolveUiThemeId, uiThemeFamilies } from "./themes.js";

const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");

/** Every token a theme block must set, so no family can half-cover the contract. */
const REQUIRED_TOKENS = [
	"background",
	"foreground",
	"card",
	"popover",
	"primary",
	"primary-foreground",
	"secondary",
	"muted",
	"muted-foreground",
	"accent",
	"destructive",
	"success",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-5",
	"sidebar",
	"sidebar-border",
	"build-icon",
	"plan-icon",
	"cursor-status-error",
];

function blockFor(id: string, appearance: "light" | "dark"): string {
	const selector =
		appearance === "dark"
			? `:root[data-ui-theme="${id}"].dark {`
			: `:root[data-ui-theme="${id}"] {`;
	const start = css.indexOf(selector);
	if (start === -1) return "";
	const end = css.indexOf("}", start);
	return css.slice(start, end);
}

describe("ui theme families", () => {
	test("every listed family has a light and a dark block", () => {
		const missing = uiThemeFamilies.flatMap((family) =>
			(["light", "dark"] as const)
				.filter((appearance) => blockFor(family.id, appearance) === "")
				.map((appearance) => `${family.id}:${appearance}`)
		);

		expect(missing).toEqual([]);
	});

	test("every block sets the whole token contract", () => {
		const gaps = uiThemeFamilies.flatMap((family) =>
			(["light", "dark"] as const).flatMap((appearance) => {
				const block = blockFor(family.id, appearance);
				return REQUIRED_TOKENS.filter((token) => !block.includes(`--${token}:`)).map(
					(token) => `${family.id}:${appearance} missing --${token}`
				);
			})
		);

		expect(gaps).toEqual([]);
	});

	test("ids are unique", () => {
		const ids = uiThemeFamilies.map((family) => family.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	test("an unknown id falls back to the default instead of leaving the app unstyled", () => {
		expect(resolveUiThemeId("nope")).toBe(DEFAULT_UI_THEME);
		expect(resolveUiThemeId(null)).toBe(DEFAULT_UI_THEME);
		expect(isUiThemeId("nope")).toBe(false);
	});
});
