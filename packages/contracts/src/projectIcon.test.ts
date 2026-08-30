import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
	hasProjectIconExtension,
	PROJECT_ICON_AUTO,
	PROJECT_ICON_NONE,
	ProjectIcon,
	ProjectIconRelativePath,
} from "./projectIcon.ts";

const decodePath = Schema.decodeUnknownEffect(ProjectIconRelativePath);
const decodeIcon = Schema.decodeUnknownEffect(ProjectIcon);

const accepts =
	(schema: (input: unknown) => Effect.Effect<unknown, unknown>) =>
	(input: unknown) =>
		Exit.isSuccess(Effect.runSyncExit(schema(input)));

const pathAccepts = accepts(decodePath);
const iconAccepts = accepts(decodeIcon);

describe("ProjectIconRelativePath", () => {
	it("accepts a path inside the project", () => {
		for (const path of [
			"logo.svg",
			"public/favicon.ico",
			"packages/ui/assets/logo.png",
			"dev/logo.WEBP",
			"a.b.c/icon.jpeg",
		]) {
			expect(pathAccepts(path)).toBe(true);
		}
	});

	it("rejects an absolute path, which is what the Tauri column stored", () => {
		expect(pathAccepts("/Users/alex/repo/logo.png")).toBe(false);
	});

	it("rejects a path that escapes the workspace root", () => {
		for (const path of [
			"../outside/logo.png",
			"assets/../../logo.png",
			"..//logo.png",
		]) {
			expect(pathAccepts(path)).toBe(false);
		}
	});

	it("rejects a backslash separator", () => {
		expect(pathAccepts("assets\\logo.png")).toBe(false);
	});

	it("rejects a file the webview cannot render", () => {
		for (const path of ["README.md", "logo", "logo.svg.txt", "icon.tiff"]) {
			expect(pathAccepts(path)).toBe(false);
		}
	});

	it("rejects an empty or blank path", () => {
		expect(pathAccepts("")).toBe(false);
		expect(pathAccepts("   ")).toBe(false);
	});
});

describe("ProjectIcon", () => {
	it("accepts each arm", () => {
		expect(iconAccepts(PROJECT_ICON_AUTO)).toBe(true);
		expect(iconAccepts(PROJECT_ICON_NONE)).toBe(true);
		expect(iconAccepts({ kind: "custom", path: "public/logo.svg" })).toBe(true);
	});

	it("keeps auto and none distinct, so a rejected detection stays rejected", () => {
		expect(PROJECT_ICON_AUTO).not.toEqual(PROJECT_ICON_NONE);
	});

	it("refuses a custom arm with no path", () => {
		expect(iconAccepts({ kind: "custom" })).toBe(false);
	});

	it("refuses a custom arm carrying an absolute path", () => {
		expect(iconAccepts({ kind: "custom", path: "/tmp/logo.png" })).toBe(false);
	});

	it("refuses an unknown kind", () => {
		expect(iconAccepts({ kind: "detected", path: "logo.png" })).toBe(false);
	});
});

describe("hasProjectIconExtension", () => {
	it("is case insensitive", () => {
		expect(hasProjectIconExtension("Logo.PNG")).toBe(true);
		expect(hasProjectIconExtension("logo.png")).toBe(true);
	});

	it("rejects a non-image", () => {
		expect(hasProjectIconExtension("notes.md")).toBe(false);
	});
});
