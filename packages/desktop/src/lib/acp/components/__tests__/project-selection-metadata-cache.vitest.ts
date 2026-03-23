import { describe, expect, it } from "vitest";

import {
	clearProjectSelectionMetadataCacheForTests,
	getCachedProjectSelectionMetadata,
	markProjectSelectionMetadataFieldLoadFinished,
	markProjectSelectionMetadataFieldLoadStarted,
	setCachedProjectSelectionMetadata,
	shouldLoadProjectSelectionMetadata,
	shouldLoadProjectSelectionMetadataField,
} from "../project-selection-metadata-cache.js";

describe("project-selection-metadata-cache", () => {
	it("allows retry after a failed field load", () => {
		const projectPath = "/tmp/project-a";

		clearProjectSelectionMetadataCacheForTests();
		expect(shouldLoadProjectSelectionMetadataField(projectPath, "branch")).toBe(true);

		markProjectSelectionMetadataFieldLoadStarted(projectPath, "branch");
		expect(shouldLoadProjectSelectionMetadataField(projectPath, "branch")).toBe(false);

		markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", false);
		expect(shouldLoadProjectSelectionMetadataField(projectPath, "branch")).toBe(true);
	});

	it("stops loading a field after success", () => {
		const projectPath = "/tmp/project-success";

		clearProjectSelectionMetadataCacheForTests();
		expect(shouldLoadProjectSelectionMetadataField(projectPath, "gitStatus")).toBe(true);

		markProjectSelectionMetadataFieldLoadStarted(projectPath, "gitStatus");
		markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", true);

		expect(shouldLoadProjectSelectionMetadataField(projectPath, "gitStatus")).toBe(false);
	});

	it("requires all fields to be loaded before treating metadata as complete", () => {
		const projectPath = "/tmp/project-both";

		clearProjectSelectionMetadataCacheForTests();
		expect(shouldLoadProjectSelectionMetadata(projectPath)).toBe(true);

		markProjectSelectionMetadataFieldLoadStarted(projectPath, "branch");
		markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", true);
		expect(shouldLoadProjectSelectionMetadata(projectPath)).toBe(true);

		markProjectSelectionMetadataFieldLoadStarted(projectPath, "gitStatus");
		markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", true);
		expect(shouldLoadProjectSelectionMetadata(projectPath)).toBe(false);
	});

	it("stores and returns cached metadata", () => {
		const projectPath = "/tmp/project-b";

		clearProjectSelectionMetadataCacheForTests();
		setCachedProjectSelectionMetadata(projectPath, {
			branch: "main",
			gitStatus: null,
		});

		expect(getCachedProjectSelectionMetadata(projectPath)).toEqual({
			branch: "main",
			gitStatus: null,
		});
	});
});
