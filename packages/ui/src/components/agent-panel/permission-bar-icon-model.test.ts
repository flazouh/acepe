import { describe, expect, it } from "vitest";

import { getPermissionBarIconModel } from "./permission-bar-icon-model.js";

describe("permission bar icon model", () => {
	it("uses Hugeicons for exact permission actions", () => {
		expect(getPermissionBarIconModel("edit")).toEqual({
			name: "edit",
			testId: "permission-bar-edit-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("execute")).toEqual({
			name: "terminal",
			testId: "permission-bar-execute-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("search")).toEqual({
			name: "search",
			testId: "permission-bar-search-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("delete")).toEqual({
			name: "trash",
			testId: "permission-bar-delete-icon",
			sizeOffset: 0,
		});
	});

	it("maps non-exact permission actions to Hugeicons", () => {
		expect(getPermissionBarIconModel("read")).toEqual({
			name: "file-text",
			testId: "permission-bar-read-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("read_lints")).toEqual({
			name: "file-text",
			testId: "permission-bar-read-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("fetch")).toEqual({
			name: "globe",
			testId: "permission-bar-fetch-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("web_search")).toEqual({
			name: "globe",
			testId: "permission-bar-fetch-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("move")).toEqual({
			name: "arrow-right",
			testId: "permission-bar-move-icon",
			sizeOffset: 0,
		});
		expect(getPermissionBarIconModel("browser")).toEqual({
			name: "app-window",
			testId: "permission-bar-browser-icon",
			sizeOffset: 0,
		});
	});

	it("maps unknown permission kinds to the Hugeicons warning fallback", () => {
		expect(getPermissionBarIconModel("unmapped")).toEqual({
			name: "shield-warning",
			testId: "permission-bar-shield-warning-icon",
			sizeOffset: -1,
		});
	});
});
