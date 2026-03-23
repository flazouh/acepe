import { describe, expect, it } from "vitest";

import {
	deriveSessionTitleFromUserInput,
	getTitleUpdateFromUserMessage,
	isFallbackSessionTitle,
	normalizeTitleForDisplay,
	stripArtifactsFromTitle,
} from "../session-title-policy.js";

describe("session-title-policy", () => {
	it("detects known fallback titles", () => {
		expect(isFallbackSessionTitle("New Thread")).toBe(true);
		expect(isFallbackSessionTitle("New session")).toBe(true);
		expect(isFallbackSessionTitle("Loading...")).toBe(true);
		expect(isFallbackSessionTitle("Real title")).toBe(false);
	});

	it("derives title from first meaningful line", () => {
		expect(deriveSessionTitleFromUserInput("Implement auth flow\nwith OAuth")).toBe(
			"Implement auth flow"
		);
	});

	it("returns null for empty input or slash command", () => {
		expect(deriveSessionTitleFromUserInput("   ")).toBeNull();
		expect(deriveSessionTitleFromUserInput("/help")).toBeNull();
	});

	it("returns update only when current title is fallback", () => {
		expect(getTitleUpdateFromUserMessage("New Thread", "Implement auth flow")).toBe(
			"Implement auth flow"
		);
		expect(getTitleUpdateFromUserMessage("Real title", "Implement auth flow")).toBeNull();
	});

	it("strips ide_opened_file artifacts from titles", () => {
		const titleWithArtifact =
			"<ide_opened_file>The user opened file.txt</ide_opened_file>My actual title";
		expect(stripArtifactsFromTitle(titleWithArtifact)).toBe("My actual title");
	});

	it("strips multiple artifact types from titles", () => {
		const titleWithMultipleArtifacts =
			"<ide_opened_file>File</ide_opened_file>Fix bug<ide_selection>Selected text</ide_selection>";
		expect(stripArtifactsFromTitle(titleWithMultipleArtifacts)).toBe("Fix bug");
	});

	it("strips system-reminder artifacts", () => {
		const titleWithReminder =
			"Implement feature<system-reminder>Some reminder text</system-reminder>";
		expect(stripArtifactsFromTitle(titleWithReminder)).toBe("Implement feature");
	});

	it("handles titles with no artifacts", () => {
		expect(stripArtifactsFromTitle("Simple title")).toBe("Simple title");
	});

	it("normalizeTitleForDisplay collapses newlines and literal \\n so title displays clean", () => {
		expect(normalizeTitleForDisplay("\nhi\n")).toBe("hi");
		expect(normalizeTitleForDisplay("  hello  \n world  ")).toBe("hello    world");
		// Literal backslash-n as sometimes stored by Cursor
		expect(normalizeTitleForDisplay("\\nhi\\n")).toBe("hi");
		expect(normalizeTitleForDisplay("\\ncan you clone t3code\\n")).toBe("can you clone t3code");
	});

	it("derives title from input with artifacts", () => {
		const inputWithArtifacts =
			"<ide_opened_file>File.ts opened</ide_opened_file>Implement auth flow\nwith OAuth";
		expect(deriveSessionTitleFromUserInput(inputWithArtifacts)).toBe("Implement auth flow");
	});

	it("treats artifact-only titles as fallback for title derivation", () => {
		// A title that's only artifacts (becomes empty after stripping) should trigger derivation
		const artifactOnlyTitle = "<ide_opened_file>The user opened file.txt</ide_opened_file>";
		expect(getTitleUpdateFromUserMessage(artifactOnlyTitle, "Fix the login bug")).toBe(
			"Fix the login bug"
		);
	});

	it("treats artifact-only titles with other whitespace as fallback", () => {
		// Artifact-only with extra whitespace should also trigger derivation
		const artifactOnlyTitle = "  <ide_opened_file>File</ide_opened_file>  ";
		expect(getTitleUpdateFromUserMessage(artifactOnlyTitle, "Implement new feature")).toBe(
			"Implement new feature"
		);
	});

	it("strips attachment tokens from titles", () => {
		expect(stripArtifactsFromTitle("@[image:/path/to/img.png] Fix the bug")).toBe("Fix the bug");
		expect(stripArtifactsFromTitle("@[file:/src/app.ts] Refactor auth")).toBe("Refactor auth");
		expect(stripArtifactsFromTitle("@[image:/a.png] @[image:/b.png] Update styles")).toBe(
			"Update styles"
		);
	});

	it("strips expanded attachment refs from titles", () => {
		expect(
			stripArtifactsFromTitle("[Attached image: /var/folders/rw/tmp/screenshot.png] Fix the bug")
		).toBe("Fix the bug");
		expect(stripArtifactsFromTitle("[Attached file: /src/app.ts] Refactor auth")).toBe(
			"Refactor auth"
		);
		expect(
			stripArtifactsFromTitle("[Attached image: /a.png] [Attached file: /b.ts] Update styles")
		).toBe("Update styles");
	});

	it("treats attachment-token-only titles as fallback", () => {
		expect(getTitleUpdateFromUserMessage("@[image:/path/to/img.png]", "Fix the login bug")).toBe(
			"Fix the login bug"
		);
	});

	it("does not treat real titles with artifacts as fallback", () => {
		// A title with both artifacts AND real content should not trigger derivation
		const mixedTitle = "<ide_opened_file>File</ide_opened_file>Real content here";
		expect(getTitleUpdateFromUserMessage(mixedTitle, "Some message")).toBeNull();
	});
});
