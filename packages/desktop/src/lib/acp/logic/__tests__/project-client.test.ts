import { describe, expect, it, mock } from "bun:test";

// Mock convertFileSrc before importing the module under test
mock.module("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import { convertIconPath, normalizeProjectIconUpdatePath } from "../project-client.js";

describe("convertIconPath", () => {
	it("returns null when iconPath is null", () => {
		const result = convertIconPath(null);
		expect(result).toBeNull();
	});

	it("returns null when iconPath is undefined", () => {
		const result = convertIconPath(undefined);
		// undefined is falsy, converted to null to match return type
		expect(result).toBeNull();
	});

	it('returns "" unchanged when iconPath is empty string (user-cleared sentinel)', () => {
		const result = convertIconPath("");
		// Empty string is falsy, passes through without calling convertFileSrc
		expect(result).toBe("");
	});

	it("does not call convertFileSrc for empty string", () => {
		// Verify the empty string is returned as-is (not converted to an asset:// URL)
		const result = convertIconPath("");
		expect(result).not.toContain("asset://");
		expect(result).toBe("");
	});

	it("returns http:// URLs unchanged", () => {
		const url = "http://example.com/logo.png";
		expect(convertIconPath(url)).toBe(url);
	});

	it("returns https:// URLs unchanged", () => {
		const url = "https://example.com/logo.png";
		expect(convertIconPath(url)).toBe(url);
	});

	it("returns data: URIs unchanged", () => {
		const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANS";
		expect(convertIconPath(dataUri)).toBe(dataUri);
	});

	it("returns asset:// URLs unchanged", () => {
		const assetUrl = "asset://localhost/path/to/icon.png";
		expect(convertIconPath(assetUrl)).toBe(assetUrl);
	});

	it("converts a filesystem path via convertFileSrc", () => {
		const result = convertIconPath("/path/to/logo.png");
		// Our mock returns asset://localhost/<encoded-path>
		expect(result).toStartWith("asset://");
		expect(result).toContain("logo.png");
	});

	it("converts a relative-looking path via convertFileSrc", () => {
		const result = convertIconPath("icons/project.svg");
		expect(result).toStartWith("asset://");
		expect(result).toContain("project.svg");
	});
});

describe("normalizeProjectIconUpdatePath", () => {
	it("converts empty string reset sentinel to null", () => {
		expect(normalizeProjectIconUpdatePath("")).toBeNull();
	});

	it("keeps file paths unchanged", () => {
		expect(normalizeProjectIconUpdatePath("/tmp/icon.png")).toBe("/tmp/icon.png");
	});

	it("keeps null unchanged", () => {
		expect(normalizeProjectIconUpdatePath(null)).toBeNull();
	});
});
