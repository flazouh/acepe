import { writeFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const waitForPitchReady = vi.fn(async () => undefined);
const exportPitchPdf = vi.fn(async (_pitchUrl: string, outputPath: string) => {
	await writeFile(outputPath, "%PDF /Type /Page");
});

vi.mock("../../../../scripts/export-pitch-pdf.js", () => ({
	createPitchUrl: (baseUrl: string) => `${baseUrl}/pitch`,
	waitForPitchReady,
	exportPitchPdf,
}));

const { GET } = await import("./+server");

describe("pitch export route", () => {
	beforeEach(() => {
		waitForPitchReady.mockClear();
		exportPitchPdf.mockClear();
	});

	it("returns a downloadable pdf attachment", async () => {
		const response = await GET({
			url: new URL("http://127.0.0.1:4173/pitch/export"),
		} as never);

		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		expect(response.headers.get("Content-Disposition")).toContain(
			'attachment; filename="acepe-investor-pitch.pdf"'
		);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(waitForPitchReady).toHaveBeenCalledWith("http://127.0.0.1:4173/pitch");
		expect(exportPitchPdf).toHaveBeenCalledTimes(1);

		const payload = Buffer.from(await response.arrayBuffer()).toString("utf8");

		expect(payload).toContain("%PDF");
	});
});
