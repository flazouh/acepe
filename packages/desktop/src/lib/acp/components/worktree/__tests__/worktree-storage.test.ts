import { describe, expect, it } from "bun:test";

import {
	getProjectWorktreeEnabled,
	isWorktreeProjectDefaultsEmpty,
	migrateWorktreeProjectDefaultsFromGlobal,
	setProjectWorktreeEnabled,
	type WorktreeProjectDefaultsMap,
} from "../worktree-storage.js";

describe("worktree-storage", () => {
	describe("getProjectWorktreeEnabled", () => {
		it("returns false when project path is missing from map", () => {
			const map: WorktreeProjectDefaultsMap = { "/repo-a": true };
			expect(getProjectWorktreeEnabled("/repo-b", map)).toBe(false);
		});

		it("returns true only when stored value is true", () => {
			const map: WorktreeProjectDefaultsMap = {
				"/repo-a": true,
				"/repo-b": false,
			};
			expect(getProjectWorktreeEnabled("/repo-a", map)).toBe(true);
			expect(getProjectWorktreeEnabled("/repo-b", map)).toBe(false);
		});
	});

	describe("setProjectWorktreeEnabled", () => {
		it("adds a new project path without mutating the source map", () => {
			const map: WorktreeProjectDefaultsMap = { "/repo-a": true };
			const next = setProjectWorktreeEnabled("/repo-b", false, map);

			expect(next).toEqual({ "/repo-a": true, "/repo-b": false });
			expect(map).toEqual({ "/repo-a": true });
		});

		it("updates an existing project path", () => {
			const map: WorktreeProjectDefaultsMap = { "/repo-a": true };
			const next = setProjectWorktreeEnabled("/repo-a", false, map);

			expect(next).toEqual({ "/repo-a": false });
		});
	});

	describe("migrateWorktreeProjectDefaultsFromGlobal", () => {
		it("seeds all known projects when legacy global default is enabled", () => {
			const migrated = migrateWorktreeProjectDefaultsFromGlobal({}, true, ["/a", "/b"]);

			expect(migrated).toEqual({ "/a": true, "/b": true });
		});

		it("does not migrate when project defaults already exist", () => {
			const existing: WorktreeProjectDefaultsMap = { "/a": false };
			const migrated = migrateWorktreeProjectDefaultsFromGlobal(existing, true, ["/a", "/b"]);

			expect(migrated).toBe(existing);
		});

		it("does not migrate when legacy global default is disabled", () => {
			const migrated = migrateWorktreeProjectDefaultsFromGlobal({}, false, ["/a", "/b"]);

			expect(migrated).toEqual({});
			expect(isWorktreeProjectDefaultsEmpty(migrated)).toBe(true);
		});
	});
});
