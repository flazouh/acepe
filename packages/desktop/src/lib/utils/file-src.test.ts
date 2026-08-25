import { describe, expect, it } from "bun:test";

import { convertFileSrc } from "./file-src.js";

describe("convertFileSrc", () => {
	it("leaves http, data, and asset URLs unchanged", () => {
		expect(convertFileSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
		expect(convertFileSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
		expect(convertFileSrc("asset://localhost/icon")).toBe("asset://localhost/icon");
	});

	it("turns an absolute path into a file URL", () => {
		expect(convertFileSrc("/tmp/icon.png")).toBe("file:///tmp/icon.png");
	});
});
