import { describe, expect, it } from "vitest";

import { computeProjectBadgeLabels } from "./project-letter-badge-labels.js";

function labels(projects: { key: string; name: string }[]): Record<string, string> {
	return Object.fromEntries(computeProjectBadgeLabels(projects));
}

describe("computeProjectBadgeLabels", () => {
	it("uses a single uppercase letter when first letters are distinct", () => {
		expect(
			labels([
				{ key: "/acepe", name: "acepe" },
				{ key: "/banana", name: "banana" },
			])
		).toEqual({ "/acepe": "A", "/banana": "B" });
	});

	it("grows the prefix until distinct when first letters collide", () => {
		expect(
			labels([
				{ key: "/acepe", name: "Acepe" },
				{ key: "/apple", name: "Apple" },
			])
		).toEqual({ "/acepe": "Ac", "/apple": "Ap" });
	});

	it("stops at two characters when a longer prefix would be needed", () => {
		expect(
			labels([
				{ key: "/acme", name: "Acme" },
				{ key: "/acorn", name: "Acorn" },
				{ key: "/apple", name: "Apple" },
			])
		).toEqual({ "/acme": "Ac", "/acorn": "Ac", "/apple": "Ap" });
	});

	it("handles a name that is a prefix of another", () => {
		expect(
			labels([
				{ key: "/ac", name: "Ac" },
				{ key: "/acepe", name: "Acepe" },
			])
		).toEqual({ "/ac": "Ac", "/acepe": "Ac" });
	});

	it("treats the first-letter comparison case-insensitively but preserves authored case", () => {
		expect(
			labels([
				{ key: "/acepe", name: "acepe" },
				{ key: "/apple", name: "APPLE" },
			])
		).toEqual({ "/acepe": "Ac", "/apple": "AP" });
	});

	it("keeps a two-character label when two projects share a name", () => {
		const result = labels([
			{ key: "/a/acepe", name: "Acepe" },
			{ key: "/b/acepe", name: "Acepe" },
		]);
		expect(result).toEqual({ "/a/acepe": "Ac", "/b/acepe": "Ac" });
	});

	it("never returns a label longer than two characters", () => {
		const result = labels([
			{ key: "/a", name: "Acepe" },
			{ key: "/b", name: "Acepe" },
			{ key: "/c", name: "Acepe Website" },
		]);
		for (const label of Object.values(result)) {
			expect(label.length).toBeLessThanOrEqual(2);
		}
	});

	it("returns a single uppercase letter for a lone project", () => {
		expect(labels([{ key: "/acepe", name: "acepe" }])).toEqual({ "/acepe": "A" });
	});

	it("handles empty names without throwing", () => {
		expect(labels([{ key: "/empty", name: "" }])).toEqual({ "/empty": "" });
	});
});
