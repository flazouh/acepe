import { describe, expect, it } from "bun:test";

import { applyDownloadEventToProgress } from "../logic/update-download-progress.js";

describe("applyDownloadEventToProgress", () => {
	it("resets downloaded bytes and stores total bytes when download starts", () => {
		const next = applyDownloadEventToProgress(
			{ downloadedBytes: 999, totalBytes: undefined },
			{ event: "Started", data: { contentLength: 1024 } }
		);

		expect(next.downloadedBytes).toBe(0);
		expect(next.totalBytes).toBe(1024);
	});

	it("increments downloaded bytes when total size is unknown", () => {
		const next = applyDownloadEventToProgress(
			{ downloadedBytes: 10, totalBytes: undefined },
			{ event: "Progress", data: { chunkLength: 25 } }
		);

		expect(next.downloadedBytes).toBe(35);
		expect(next.totalBytes).toBeUndefined();
	});

	it("clamps downloaded bytes to total size when known", () => {
		const next = applyDownloadEventToProgress(
			{ downloadedBytes: 98, totalBytes: 100 },
			{ event: "Progress", data: { chunkLength: 8 } }
		);

		expect(next.downloadedBytes).toBe(100);
		expect(next.totalBytes).toBe(100);
	});

	it("sets downloaded bytes to total on finished event", () => {
		const next = applyDownloadEventToProgress(
			{ downloadedBytes: 80, totalBytes: 100 },
			{ event: "Finished" }
		);

		expect(next.downloadedBytes).toBe(100);
		expect(next.totalBytes).toBe(100);
	});
});
