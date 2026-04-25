import { describe, expect, it } from "bun:test";

import {
	buildRichTokenTextClassName,
	buildRichTokenTextSegmentClassName,
} from "./rich-token-text.classes.js";

describe("rich-token-text classes", () => {
	it("supports the default wrapping layout for message bodies", () => {
		expect(buildRichTokenTextClassName({ singleLine: false })).toContain(
			"break-words",
		);
		expect(buildRichTokenTextSegmentClassName({ singleLine: false })).toContain(
			"whitespace-pre-wrap",
		);
	});

	it("supports single-line clipping for dense rows", () => {
		const rootClassName = buildRichTokenTextClassName({ singleLine: true });
		const segmentClassName = buildRichTokenTextSegmentClassName({
			singleLine: true,
		});

		expect(rootClassName).toContain("max-w-full");
		expect(rootClassName).toContain("overflow-hidden");
		expect(rootClassName).toContain("text-ellipsis");
		expect(rootClassName).toContain("whitespace-nowrap");
		expect(rootClassName).not.toContain("break-words");
		expect(segmentClassName).toBe("whitespace-nowrap");
	});
});
