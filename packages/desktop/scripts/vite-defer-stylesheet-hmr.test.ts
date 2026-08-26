import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { splitStylesheetUpdate, toHmrUpdatePath } from "./vite-defer-stylesheet-hmr.js";

const viteRoot = join(import.meta.dirname, "..");
const stylesheetPath = toHmrUpdatePath(viteRoot, join(viteRoot, "src/app.css"));

const componentUpdate = { type: "js-update", path: "/src/lib/components/top-bar/top-bar.svelte" };
const stylesheetUpdate = { type: "js-update", path: "/src/app.css" };

describe("toHmrUpdatePath", () => {
	it("maps the stylesheet file to the url Vite puts in update payloads", () => {
		expect(stylesheetPath).toBe("/src/app.css");
	});
});

describe("splitStylesheetUpdate", () => {
	it("splits a payload that mixes the stylesheet with another module", () => {
		const split = splitStylesheetUpdate(
			{ type: "update", updates: [componentUpdate, stylesheetUpdate] },
			stylesheetPath
		);

		expect(split?.rest).toEqual([componentUpdate]);
		expect(split?.stylesheet).toEqual([stylesheetUpdate]);
	});

	it("leaves a stylesheet-only payload alone, so editing app.css keeps the normal path", () => {
		expect(
			splitStylesheetUpdate({ type: "update", updates: [stylesheetUpdate] }, stylesheetPath)
		).toBeNull();
	});

	it("leaves a payload without the stylesheet alone", () => {
		expect(
			splitStylesheetUpdate({ type: "update", updates: [componentUpdate] }, stylesheetPath)
		).toBeNull();
	});

	it("leaves other payload types alone", () => {
		expect(splitStylesheetUpdate({ type: "full-reload" }, stylesheetPath)).toBeNull();
		expect(
			splitStylesheetUpdate({ type: "prune", paths: ["/src/app.css"] }, stylesheetPath)
		).toBeNull();
	});

	it("forwards an unexpected payload shape untouched instead of throwing", () => {
		expect(splitStylesheetUpdate({ type: "update" }, stylesheetPath)).toBeNull();
		expect(splitStylesheetUpdate({ type: "update", updates: "nope" }, stylesheetPath)).toBeNull();
		expect(splitStylesheetUpdate(null, stylesheetPath)).toBeNull();
		expect(splitStylesheetUpdate("update", stylesheetPath)).toBeNull();
	});
});
