import { describe, expect, it } from "bun:test";

import { buildInlineArtefactIconClassName } from "./inline-artefact-badge.styles.js";

describe("buildInlineArtefactIconClassName", () => {
	it("uses violet accents for command and skill artefacts", () => {
		expect(buildInlineArtefactIconClassName("command")).toContain("text-violet-500");
		expect(buildInlineArtefactIconClassName("skill")).toContain("text-violet-500");
	});

	it("uses success green for clipboard artefacts", () => {
		expect(buildInlineArtefactIconClassName("text")).toContain("text-success");
		expect(buildInlineArtefactIconClassName("text_ref")).toContain("text-success");
	});

	it("keeps file and image artefacts unaccented", () => {
		expect(buildInlineArtefactIconClassName("file")).toBe("");
		expect(buildInlineArtefactIconClassName("image")).toBe("");
	});
});
