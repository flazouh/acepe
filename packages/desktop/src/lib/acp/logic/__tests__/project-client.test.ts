import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ProjectClient } from "../project-client.js";
import type { Project } from "../project-manager.svelte.js";

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

describe("ProjectClient hot cache", () => {
	it("round-trips cached projects without calling the backend", () => {
		const client = new ProjectClient();
		client.writeCachedProjects([createProject("/repo/acepe", "Acepe")]);

		const cachedProjects = client.getCachedProjects();

		expect(cachedProjects).toHaveLength(1);
		expect(cachedProjects?.[0]?.path).toBe("/repo/acepe");
		expect(cachedProjects?.[0]?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(cachedProjects?.[0]?.lastOpened?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
		expect(cachedProjects?.[0]?.sortOrder).toBe(3);
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
