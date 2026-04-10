import { describe, expect, it } from "bun:test";
import { parseShipXml } from "./ship-card-parser.js";

describe("parseShipXml", () => {
	it("returns all-null for empty string", () => {
		const result = parseShipXml("");
		expect(result.started).toBe(false);
		expect(result.complete).toBe(false);
		expect(result.commitMessage).toBeNull();
		expect(result.prTitle).toBeNull();
		expect(result.prDescription).toBeNull();
		expect(result.activeField).toBeNull();
	});

	it("returns all-null for text without <ship>", () => {
		const result = parseShipXml("Hello world, some random text");
		expect(result.started).toBe(false);
		expect(result.complete).toBe(false);
	});

	it("detects started but not complete when only <ship> present", () => {
		const result = parseShipXml("<ship>");
		expect(result.started).toBe(true);
		expect(result.complete).toBe(false);
		expect(result.activeField).toBeNull();
	});

	it("parses partial commit message during streaming", () => {
		const result = parseShipXml("<ship>\n<commit-message>feat: ad");
		expect(result.started).toBe(true);
		expect(result.complete).toBe(false);
		expect(result.commitMessage).toBe("feat: ad");
		expect(result.activeField).toBe("commit-message");
		expect(result.prTitle).toBeNull();
	});

	it("parses complete commit message", () => {
		const result = parseShipXml("<ship>\n<commit-message>feat: add login</commit-message>");
		expect(result.commitMessage).toBe("feat: add login");
		expect(result.activeField).toBeNull();
		expect(result.complete).toBe(false); // no </ship> yet
	});

	it("parses all three tags when complete", () => {
		const xml = `<ship>
<commit-message>feat: add login

Adds OAuth2 flow</commit-message>
<pr-title>Add user login with OAuth2</pr-title>
<pr-description>
## Summary
- Added login flow

## Testing
1. Run the app
</pr-description>
</ship>`;

		const result = parseShipXml(xml);
		expect(result.started).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.commitMessage).toBe("feat: add login\n\nAdds OAuth2 flow");
		expect(result.prTitle).toBe("Add user login with OAuth2");
		expect(result.prDescription).toContain("## Summary");
		expect(result.prDescription).toContain("## Testing");
		expect(result.activeField).toBeNull();
	});

	it("handles markdown inside pr-description with newlines and code blocks", () => {
		const xml = `<ship>
<commit-message>fix: handle edge case</commit-message>
<pr-title>Fix edge case in parser</pr-title>
<pr-description>
## Summary
- Fixed \`Array<string>\` handling in parser

## Changes
- **\`src/parser.ts\`** (+5 -2) — Handle generic types

## Testing
1. Run \`bun test\`
</pr-description>
</ship>`;

		const result = parseShipXml(xml);
		expect(result.prDescription).toContain("Array<string>");
		expect(result.prDescription).toContain("**`src/parser.ts`**");
		expect(result.complete).toBe(true);
	});

	it("strips trailing incomplete closing tag during streaming", () => {
		const result = parseShipXml("<ship>\n<pr-description>## Summary\n- Added feature</pr-descrip");
		expect(result.prDescription).toBe("## Summary\n- Added feature");
		expect(result.activeField).toBe("pr-description");
	});

	it("handles pr-title streaming mid-word", () => {
		const result = parseShipXml(
			"<ship>\n<commit-message>feat: done</commit-message>\n<pr-title>Add fea"
		);
		expect(result.commitMessage).toBe("feat: done");
		expect(result.prTitle).toBe("Add fea");
		expect(result.activeField).toBe("pr-title");
	});

	it("gracefully handles missing tags (malformed XML)", () => {
		const result = parseShipXml("<ship>\nsome random text\n</ship>");
		expect(result.started).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.commitMessage).toBeNull();
		expect(result.prTitle).toBeNull();
		expect(result.prDescription).toBeNull();
	});

	it("handles empty tags", () => {
		const xml =
			"<ship>\n<commit-message></commit-message>\n<pr-title></pr-title>\n<pr-description></pr-description>\n</ship>";
		const result = parseShipXml(xml);
		expect(result.commitMessage).toBe("");
		expect(result.prTitle).toBe("");
		expect(result.prDescription).toBe("");
		expect(result.complete).toBe(true);
	});
});
