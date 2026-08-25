import { describe, expect, it, mock } from "bun:test";

import { openUrl } from "./open-url.js";

describe("openUrl", () => {
	it("opens the URL in a new browsing context", async () => {
		const open = mock(() => null);
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { open },
		});

		await openUrl("https://acepe.dev");

		expect(open).toHaveBeenCalledWith("https://acepe.dev", "_blank", "noopener,noreferrer");
	});
});
