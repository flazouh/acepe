import { describe, expect, it } from "bun:test";

import {
	STRUCTURED_VIEW_ROW_ESTIMATE_PX,
	shouldVirtualizeStructuredEntries,
} from "./file-panel-structured-virtualization";

describe("file-panel structured virtualization", () => {
	it("does not virtualize when entries are below threshold", () => {
		expect(shouldVirtualizeStructuredEntries(99)).toBe(false);
	});

	it("virtualizes once entries reach threshold", () => {
		expect(shouldVirtualizeStructuredEntries(100)).toBe(true);
	});

	it("uses a stable row estimate for virtualizer layout", () => {
		expect(STRUCTURED_VIEW_ROW_ESTIMATE_PX).toBe(38);
	});
});
