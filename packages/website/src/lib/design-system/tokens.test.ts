import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { allDeclaredTokenNames, colorGroups } from "./tokens.js";

function read(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * The design-system page is only trustworthy while every token it advertises is
 * really declared. A renamed or deleted custom property must fail here, not
 * render as an empty swatch nobody notices.
 */
const stylesheets = [
	read("../../routes/layout.css"),
	read("../../../../ui/src/lib/design-tokens.css"),
].join("\n");

describe("design-system token catalogue", () => {
	test("every advertised token is declared in a stylesheet", () => {
		const missing = allDeclaredTokenNames().filter(
			(name) => !new RegExp(`--${name}\\s*:`).test(stylesheets)
		);

		expect(missing).toEqual([]);
	});

	test("group ids are unique so the nav can anchor to them", () => {
		const ids = colorGroups.map((group) => group.id);

		expect(new Set(ids).size).toBe(ids.length);
	});
});
