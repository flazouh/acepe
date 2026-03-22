import { describe, expect, it } from "bun:test";

import {
	createFilePanelCacheKey,
	getFirstAttachedFilePanelId,
	normalizeOpenFilePanelOptions,
	remapOwnerPanelId,
} from "../file-panel-ownership.js";

describe("file panel ownership helpers", () => {
	it("normalizes number width options", () => {
		expect(normalizeOpenFilePanelOptions(640)).toEqual({ width: 640 });
	});

	it("normalizes object options", () => {
		expect(normalizeOpenFilePanelOptions({ ownerPanelId: "panel-1", width: 700 })).toEqual({
			ownerPanelId: "panel-1",
			width: 700,
		});
	});

	it("creates owner-aware cache keys", () => {
		expect(createFilePanelCacheKey("src/main.ts", "/workspace/app", "panel-1")).toBe(
			"panel-1:/workspace/app:src/main.ts"
		);
		expect(createFilePanelCacheKey("src/main.ts", "/workspace/app", null)).toBe(
			"global:/workspace/app:src/main.ts"
		);
	});

	it("returns first attached panel id for an owner", () => {
		expect(
			getFirstAttachedFilePanelId(
				[
					{
						id: "file-1",
						filePath: "src/one.ts",
						projectPath: "/workspace/app",
						ownerPanelId: "panel-1",
						width: 500,
					},
					{
						id: "file-2",
						filePath: "src/two.ts",
						projectPath: "/workspace/app",
						ownerPanelId: "panel-2",
						width: 500,
					},
				],
				"panel-1"
			)
		).toBe("file-1");
		expect(getFirstAttachedFilePanelId([], "panel-1")).toBeNull();
	});

	it("remaps owner ids when mapping exists", () => {
		const ownerMap = new Map([["old-panel-id", "new-panel-id"]]);
		expect(remapOwnerPanelId("old-panel-id", ownerMap)).toBe("new-panel-id");
		expect(remapOwnerPanelId("missing", ownerMap)).toBe("missing");
		expect(remapOwnerPanelId(null, ownerMap)).toBeNull();
	});
});
