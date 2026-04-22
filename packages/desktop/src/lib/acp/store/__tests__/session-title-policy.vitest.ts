import { describe, expect, it } from "vitest";

import {
	deriveSessionTitleFromUserInput,
	formatRichSessionTitle,
	formatSessionTitleForDisplay,
	getTitleUpdateFromUserMessage,
	isFallbackSessionTitle,
	normalizeTitleForDisplay,
	stripArtifactsFromTitle,
	stripXmlArtifactsFromTitle,
	titleHasInlineTokens,
} from "../session-title-policy.js";

describe("session-title-policy", () => {
	it("detects known fallback titles", () => {
		expect(isFallbackSessionTitle("New Thread")).toBe(true);
		expect(isFallbackSessionTitle("New session")).toBe(true);
		expect(isFallbackSessionTitle("Loading...")).toBe(true);
		expect(isFallbackSessionTitle("Session 24745d00")).toBe(true);
		expect(isFallbackSessionTitle("Real title")).toBe(false);
		expect(isFallbackSessionTitle("Session planning")).toBe(false);
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
		expect(getTitleUpdateFromUserMessage("Session 24745d00", "Investigate kanban crash")).toBe(
			"Investigate kanban crash"
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

	it("formatSessionTitleForDisplay title-cases a stored title", () => {
		expect(formatSessionTitleForDisplay("fix kanban title drift", null)).toBe(
			"Fix Kanban Title Drift"
		);
	});

	it("formatSessionTitleForDisplay falls back to project conversation title", () => {
		expect(formatSessionTitleForDisplay("", "acepe")).toBe("Conversation In Acepe");
	});

	it("formatSessionTitleForDisplay returns untitled fallback when no title or project exists", () => {
		expect(formatSessionTitleForDisplay("", null)).toBe("Untitled conversation");
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

	describe("stripXmlArtifactsFromTitle", () => {
		it("strips XML tags but preserves @[type:value] tokens", () => {
			const title = "<ide_opened_file>File</ide_opened_file>@[image:/screenshot.png] Fix bug";
			expect(stripXmlArtifactsFromTitle(title)).toBe("@[image:/screenshot.png] Fix bug");
		});

		it("preserves title with only tokens", () => {
			expect(stripXmlArtifactsFromTitle("@[image:/a.png] @[file:/b.ts]")).toBe(
				"@[image:/a.png] @[file:/b.ts]"
			);
		});

		it("returns title unchanged when no artifacts", () => {
			expect(stripXmlArtifactsFromTitle("Simple title")).toBe("Simple title");
		});

		it("strips expanded refs but keeps tokens", () => {
			expect(stripXmlArtifactsFromTitle("[Attached image: /a.png] @[file:/b.ts] Fix")).toBe(
				"@[file:/b.ts] Fix"
			);
		});

		it("returns empty string for XML-only title", () => {
			expect(stripXmlArtifactsFromTitle("<ide_opened_file>File</ide_opened_file>")).toBe("");
		});

		it("normalizes newlines in rich title", () => {
			expect(stripXmlArtifactsFromTitle("@[file:/a.ts]\nFix bug")).toBe("@[file:/a.ts] Fix bug");
		});

		it("normalizes literal backslash-n", () => {
			expect(stripXmlArtifactsFromTitle("@[file:/a.ts]\\nFix bug")).toBe("@[file:/a.ts] Fix bug");
		});

		it("preserves truncated tokens missing closing bracket", () => {
			expect(stripXmlArtifactsFromTitle("@[image:/var/folders/rw/long-path-here...")).toBe(
				"@[image:/var/folders/rw/long-path-here..."
			);
		});
	});

	describe("titleHasInlineTokens", () => {
		it("returns true for titles with tokens", () => {
			expect(titleHasInlineTokens("@[file:/app.ts] Fix bug")).toBe(true);
			expect(titleHasInlineTokens("@[image:/screenshot.png]")).toBe(true);
			expect(titleHasInlineTokens("@[text:SGVsbG8=]")).toBe(true);
		});

		it("returns false for plain titles", () => {
			expect(titleHasInlineTokens("Simple title")).toBe(false);
			expect(titleHasInlineTokens("")).toBe(false);
		});

		it("returns true for truncated tokens missing closing bracket", () => {
			expect(titleHasInlineTokens("@[image:/var/folders/rw/long-path...")).toBe(true);
		});
	});

	describe("formatRichSessionTitle", () => {
		it("returns richText when title has tokens", () => {
			const result = formatRichSessionTitle("@[file:/app.ts] Fix bug", "acepe");
			expect(result.richText).toBe("@[file:/app.ts] Fix bug");
			expect(result.plainText).toBe("Fix bug");
		});

		it("returns null richText when title has no tokens", () => {
			const result = formatRichSessionTitle("Simple title", "acepe");
			expect(result.richText).toBeNull();
			expect(result.plainText).toBe("Simple title");
		});

		it("returns richText for token-only title with fallback plainText", () => {
			const result = formatRichSessionTitle("@[image:/screenshot.png]", "acepe");
			expect(result.richText).toBe("@[image:/screenshot.png]");
			expect(result.plainText).toBe("Conversation in acepe");
		});

		it("strips XML tags from richText but preserves tokens", () => {
			const result = formatRichSessionTitle(
				"<ide_opened_file>File</ide_opened_file>@[file:/app.ts] Fix auth",
				"acepe"
			);
			expect(result.richText).toBe("@[file:/app.ts] Fix auth");
			expect(result.plainText).toBe("Fix auth");
		});

		it("capitalizes first non-token text character in richText", () => {
			const result = formatRichSessionTitle("@[file:/app.ts] fix bug", "acepe");
			expect(result.richText).toBe("@[file:/app.ts] Fix bug");
		});

		it("returns null richText for null/undefined title", () => {
			expect(formatRichSessionTitle(null, "acepe").richText).toBeNull();
			expect(formatRichSessionTitle(undefined, "acepe").richText).toBeNull();
		});

		it("returns null richText for empty title", () => {
			const result = formatRichSessionTitle("", "acepe");
			expect(result.richText).toBeNull();
			expect(result.plainText).toBe("Conversation in acepe");
		});

		it("handles truncated tokens missing closing bracket", () => {
			const result = formatRichSessionTitle("@[image:/var/folders/rw/long-path-here...", "acepe");
			expect(result.richText).toBe("@[image:/var/folders/rw/long-path-here...");
			expect(result.plainText).toBe("Conversation in acepe");
		});
	});
});
