import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Project } from "../project-manager.svelte.js";

// Mock convertFileSrc before importing the module under test
mock.module("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import {
	convertIconPath,
	normalizeProjectIconUpdatePath,
	ProjectClient,
} from "../project-client.js";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let localStorageValues: Map<string, string>;

function createProject(path: string, name: string): Project {
	return {
		path,
		name,
		lastOpened: new Date("2026-01-02T00:00:00.000Z"),
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		color: "#00BCD4",
		sortOrder: 3,
		iconPath: "/tmp/project.png",
		showExternalCliSessions: true,
	};
}

beforeEach(() => {
	localStorageValues = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: mock((key: string) => localStorageValues.get(key) ?? null),
			setItem: mock((key: string, value: string) => {
				localStorageValues.set(key, value);
			}),
			removeItem: mock((key: string) => {
				localStorageValues.delete(key);
			}),
		} satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
	});
});

afterEach(() => {
	if (originalLocalStorageDescriptor === undefined) {
		Reflect.deleteProperty(globalThis, "localStorage");
		return;
	}
	Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
});

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

describe("ProjectClient hot cache", () => {
	it("round-trips cached projects without invoking Tauri", () => {
		const client = new ProjectClient();
		client.writeCachedProjects([createProject("/repo/acepe", "Acepe")]);

		const cachedProjects = client.getCachedProjects();

		expect(cachedProjects).toHaveLength(1);
		expect(cachedProjects?.[0]?.path).toBe("/repo/acepe");
		expect(cachedProjects?.[0]?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(cachedProjects?.[0]?.lastOpened?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
		expect(cachedProjects?.[0]?.iconPath).toStartWith("asset://");
		expect(cachedProjects?.[0]?.showExternalCliSessions).toBe(true);
	});

	it("drops malformed cached projects", () => {
		localStorageValues.set("acepe.projects.hot_cache", "{not json");
		const client = new ProjectClient();

		const cachedProjects = client.getCachedProjects();

		expect(cachedProjects).toBeNull();
		expect(localStorageValues.has("acepe.projects.hot_cache")).toBe(false);
	});
});
