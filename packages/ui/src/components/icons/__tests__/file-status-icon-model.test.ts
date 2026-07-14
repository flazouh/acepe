import { describe, expect, it } from "vitest";

import { getFileStatusIconModel } from "../file-status-icon-model.js";

describe("file status icon model", () => {
	it("uses Hugeicons for exact file status actions", () => {
		expect(getFileStatusIconModel("deleted")).toEqual({
			name: "trash",
		});
		expect(getFileStatusIconModel("renamed")).toEqual({
			name: "edit",
		});
	});

	it("maps added and untracked statuses to the Hugeicons add icon", () => {
		expect(getFileStatusIconModel("added")).toEqual({
			name: "add",
		});
		expect(getFileStatusIconModel("untracked")).toEqual({
			name: "add",
		});
	});
});
