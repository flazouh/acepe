import { describe, expect, it } from "vitest";

import {
	getFallbackIconSrc,
	getFileIconName,
	getFileIconSrc,
	getFilenameIconName,
} from "./extension-map.js";

describe("file icon extension map", () => {
	it("resolves language-specific SVG paths from the file-type pack", () => {
		expect(getFileIconSrc("main.ts")).toBe("/svgs/icons/typescript.svg");
		expect(getFileIconSrc("App.tsx")).toBe("/svgs/icons/react_ts.svg");
		expect(getFileIconSrc("Widget.svelte")).toBe("/svgs/icons/svelte.svg");
		expect(getFileIconSrc("lib.rs")).toBe("/svgs/icons/rust.svg");
		expect(getFileIconName("ts")).toBe("typescript");
		expect(getFileIconName("svelte")).toBe("svelte");
	});

	it("matches special filenames from a full path basename", () => {
		expect(getFilenameIconName("packages/ui/package.json")).toBe("npm");
		expect(getFileIconSrc("packages/ui/package.json")).toBe("/svgs/icons/npm.svg");
	});

	it("keeps the fallback on the same SVG pack base path", () => {
		expect(getFallbackIconSrc()).toBe("/svgs/icons/file.svg");
		expect(getFileIconSrc("unknown.zzzz")).toBe("/svgs/icons/file.svg");
	});

	it("strips :line and :line:column suffixes before resolving icons", () => {
		expect(getFileIconSrc("tests.rs:914")).toBe("/svgs/icons/rust.svg");
		expect(getFileIconSrc("vitest.config.ts:10")).toBe("/svgs/icons/vitest.svg");
		expect(getFileIconSrc("src/app.ts:12:4")).toBe("/svgs/icons/typescript.svg");
		expect(getFileIconSrc("packages/ui/package.json:3")).toBe("/svgs/icons/npm.svg");
	});
});
