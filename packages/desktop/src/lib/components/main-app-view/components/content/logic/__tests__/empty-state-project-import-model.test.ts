import { describe, expect, it } from "bun:test";

import {
	buildProjectImportErrorState,
	buildProjectImportIssueDraft,
} from "../empty-state-project-import-model.js";

describe("empty-state project import model", () => {
	it("builds user-facing error state from error details and a reference", () => {
		const errorState = buildProjectImportErrorState({
			error: new Error("Unable to import project"),
			causeDetails: {
				chain: ["Unable to import project", "Missing package.json"],
				rootCause: "Missing package.json",
				formatted: "Unable to import project (cause: Missing package.json)",
			},
			reference: {
				referenceId: "ref-123",
				searchable: true,
			},
		});

		expect(errorState).toEqual({
			title: "Project import failed",
			summary: "Missing package.json",
			details: "Unable to import project (cause: Missing package.json)",
			referenceId: "ref-123",
			referenceSearchable: true,
		});
	});

	it("falls back to the error message when no root cause exists", () => {
		const errorState = buildProjectImportErrorState({
			error: new Error("Permission denied"),
			causeDetails: {
				chain: ["Permission denied"],
				rootCause: null,
				formatted: "Permission denied",
			},
			reference: {
				referenceId: "local-1",
				searchable: false,
			},
		});

		expect(errorState.summary).toBe("Permission denied");
		expect(errorState.referenceSearchable).toBe(false);
	});

	it("does not build an issue draft without an error", () => {
		expect(
			buildProjectImportIssueDraft({
				errorState: null,
				projectPath: "/repo",
				projectName: "acepe",
			})
		).toBe(null);
	});

	it("builds a complete issue draft with project context", () => {
		const draft = buildProjectImportIssueDraft({
			errorState: {
				title: "Project import failed",
				summary: "Missing package.json",
				details: "Unable to import project (cause: Missing package.json)",
				referenceId: "ref-123",
				referenceSearchable: true,
			},
			projectPath: "/repo",
			projectName: "acepe",
		});

		expect(draft?.title).toBe("Project import failed: Missing package.json");
		expect(draft?.referenceId).toBe("ref-123");
		expect(draft?.referenceSearchable).toBe(true);
		expect(draft?.surface).toBe("empty-state-project-import");
		expect(draft?.diagnosticsSummary).toBe("Missing package.json");
		expect(draft?.body).toContain("| Project Path | /repo |");
		expect(draft?.body).toContain("| Project Name | acepe |");
	});
});
