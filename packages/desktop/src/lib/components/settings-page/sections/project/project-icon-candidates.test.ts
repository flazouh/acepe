import { describe, expect, it } from "vitest";

import {
	filterProjectIconCandidates,
	projectIconRank,
	rankProjectIconCandidates,
} from "./project-icon-candidates.js";

describe("rankProjectIconCandidates", () => {
	it("drops files that are not images", () => {
		expect(rankProjectIconCandidates(["README.md", "logo.svg", "src/main.ts"])).toEqual([
			"logo.svg",
		]);
	});

	it("puts a conventionally named and placed mark first", () => {
		const ranked = rankProjectIconCandidates([
			"packages/ui/static/svgs/zebra.svg",
			"assets/logo.svg",
		]);
		expect(ranked[0]).toBe("assets/logo.svg");
	});

	it("beats an alphabetically earlier vendored glyph", () => {
		// The real failure this fixes: this repo offers 2449 images, most of
		// them file-type glyphs, and sorting by name alone buried the project's
		// own logo behind every one starting with an earlier letter.
		const ranked = rankProjectIconCandidates([
			"packages/desktop/static/svgs/files/abap.svg",
			"packages/desktop/static/svgs/files/ada.svg",
			"logo.png",
		]);
		expect(ranked[0]).toBe("logo.png");
	});

	it("prefers a shallower path when the rank ties", () => {
		const ranked = rankProjectIconCandidates(["a/b/c/logo.svg", "a/logo.svg"]);
		expect(ranked).toEqual(["a/logo.svg", "a/b/c/logo.svg"]);
	});

	it("is a total order, so the grid does not reshuffle on reload", () => {
		const paths = ["b/icon.svg", "a/icon.svg", "logo.svg", "public/favicon.ico"];
		const once = rankProjectIconCandidates(paths);
		const twice = rankProjectIconCandidates([...paths].reverse());
		expect(once).toEqual(twice);
	});

	it("leaves the input array untouched", () => {
		const paths = ["z.png", "a.png"];
		rankProjectIconCandidates(paths);
		expect(paths).toEqual(["z.png", "a.png"]);
	});
});

describe("projectIconRank", () => {
	it("ranks a named mark in a conventional directory best", () => {
		expect(projectIconRank("public/logo.svg")).toBe(0);
		expect(projectIconRank("logo.svg")).toBe(0);
	});

	it("ranks a named mark anywhere above an unnamed one", () => {
		expect(projectIconRank("deep/nested/logo.svg")).toBeLessThan(
			projectIconRank("deep/nested/screenshot.png")
		);
	});

	it("ranks an unnamed image in a conventional directory above a vendored one", () => {
		expect(projectIconRank("assets/hero.png")).toBeLessThan(
			projectIconRank("vendor/glyphs/abap.svg")
		);
	});
});

describe("filterProjectIconCandidates", () => {
	it("returns everything for an empty query", () => {
		expect(filterProjectIconCandidates(["a.png", "b.png"], "   ")).toEqual(["a.png", "b.png"]);
	});

	it("matches on any part of the path, case insensitively", () => {
		expect(filterProjectIconCandidates(["packages/ui/Logo.svg", "a.png"], "logo")).toEqual([
			"packages/ui/Logo.svg",
		]);
	});

	it("requires every term, so two words narrow rather than widen", () => {
		const paths = ["packages/ui/logo.svg", "packages/desktop/logo.svg"];
		expect(filterProjectIconCandidates(paths, "ui logo")).toEqual(["packages/ui/logo.svg"]);
	});
});
