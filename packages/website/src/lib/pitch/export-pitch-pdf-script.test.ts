import { describe, expect, it, vi } from "vitest";

import {
	countPdfPages,
	createPitchUrl,
	createPreviewArgs,
	createPreviewBaseUrl,
	parseExportPitchPdfArgs,
	waitForPitchReady,
} from "../../../scripts/export-pitch-pdf.js";

describe("export pitch pdf script", () => {
	it("parses defaults and custom overrides", () => {
		const defaults = parseExportPitchPdfArgs([]);
		const overrides = parseExportPitchPdfArgs([
			"--base-url",
			"http://localhost:9999",
			"--output",
			"tmp/pitch.pdf",
			"--port",
			"4999",
		]);

		expect(defaults.baseUrl).toBeNull();
		expect(defaults.outputPath.endsWith("artifacts/acepe-investor-pitch.pdf")).toBe(true);
		expect(defaults.port).toBe(4173);
		expect(overrides.baseUrl).toBe("http://localhost:9999");
		expect(overrides.outputPath.endsWith("tmp/pitch.pdf")).toBe(true);
		expect(overrides.port).toBe(4999);
	});

	it("builds preview and pitch urls deterministically", () => {
		expect(createPreviewBaseUrl(4173)).toBe("http://127.0.0.1:4173");
		expect(createPitchUrl("http://127.0.0.1:4173")).toBe("http://127.0.0.1:4173/pitch");
		expect(createPreviewArgs(4173)).toEqual([
			"run",
			"preview",
			"--",
			"--host",
			"127.0.0.1",
			"--port",
			"4173",
		]);
	});

	it("waits until the pitch readiness marker appears", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error("connect refused"))
			.mockResolvedValueOnce(new Response("<html>still loading</html>", { status: 200 }))
			.mockResolvedValueOnce(new Response("<div data-pitch-root></div>", { status: 200 }));

		await expect(
			waitForPitchReady("http://127.0.0.1:4173/pitch", fetchMock, 3, 0)
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("fails when the pitch route never becomes ready", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
			return new Response("<html>missing marker</html>", { status: 200 });
		});

		await expect(waitForPitchReady("http://127.0.0.1:4173/pitch", fetchMock, 2, 0)).rejects.toThrow(
			"Pitch route never became ready"
		);
	});

	it("counts pdf pages from the generated artifact source", () => {
		expect(countPdfPages("%PDF /Type /Page /Type /Page /Type /Pages")).toBe(2);
	});
});
