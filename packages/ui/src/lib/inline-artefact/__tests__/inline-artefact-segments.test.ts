import { describe, expect, it } from "bun:test";

import { tokenizeInlineArtefacts } from "../inline-artefact-segments.js";

function encodeInlineText(content: string): string {
	return btoa(unescape(encodeURIComponent(content)));
}

describe("tokenizeInlineArtefacts", () => {
	it("derives pasted-text chip metadata from persisted text tokens", () => {
		const encoded = encodeInlineText("const value = 42;\nconsole.log(value);");

		const segments = tokenizeInlineArtefacts(`Before @[text:${encoded}] after`);
		const artefact = segments[1];

		expect(artefact).toMatchObject({
			kind: "artefact",
			tokenType: "text",
			label: "const value = 42;",
			charCount: 37,
			title: "const value = 42;\nconsole.log(value);",
		});
	});

	it("falls back gracefully when pasted-text token content cannot be decoded", () => {
		const segments = tokenizeInlineArtefacts("@[text:not-base64]");
		const artefact = segments[0];

		expect(artefact).toMatchObject({
			kind: "artefact",
			tokenType: "text",
			label: "Pasted text",
		});
		expect("charCount" in artefact ? artefact.charCount : undefined).toBeUndefined();
		expect("title" in artefact ? artefact.title : undefined).toBeUndefined();
	});
});