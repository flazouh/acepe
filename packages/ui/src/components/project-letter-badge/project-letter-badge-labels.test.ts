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

	it("extends the prefix past a shared multi-letter run", () => {
		expect(
			labels([
				{ key: "/acme", name: "Acme" },
				{ key: "/acorn", name: "Acorn" },
				{ key: "/apple", name: "Apple" },
			])
		).toEqual({ "/acme": "Acm", "/acorn": "Aco", "/apple": "Ap" });
	});

	it("handles a name that is a prefix of another", () => {
		expect(
			labels([
				{ key: "/ac", name: "Ac" },
				{ key: "/acepe", name: "Acepe" },
			])
		).toEqual({ "/ac": "Ac", "/acepe": "Ace" });
	});

	it("treats the first-letter comparison case-insensitively but preserves authored case", () => {
		expect(
			labels([
				{ key: "/acepe", name: "acepe" },
				{ key: "/apple", name: "APPLE" },
			])
		).toEqual({ "/acepe": "Ac", "/apple": "AP" });
	});

	it("falls back to the full name when two projects share a name", () => {
		const result = labels([
			{ key: "/a/acepe", name: "Acepe" },
			{ key: "/b/acepe", name: "Acepe" },
		]);
		expect(result).toEqual({ "/a/acepe": "Acepe", "/b/acepe": "Acepe" });
	});

	it("returns a single uppercase letter for a lone project", () => {
		expect(labels([{ key: "/acepe", name: "acepe" }])).toEqual({ "/acepe": "A" });
	});

	it("handles empty names without throwing", () => {
		expect(labels([{ key: "/empty", name: "" }])).toEqual({ "/empty": "" });
	});
});
