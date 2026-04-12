import { writeFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportPitchPdf = vi.fn(async (options: { outputPath: string }) => {
	await writeFile(options.outputPath, "%PDF /Type /Page");
});

vi.mock("../../../../scripts/export-pitch-pdf.js", () => ({
	exportPitchPdf,
}));

const { GET } = await import("./+server");

describe("pitch export route", () => {
	beforeEach(() => {
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
		expect(exportPitchPdf).toHaveBeenCalledWith({
			baseUrl: "http://127.0.0.1:4173",
			outputPath: expect.stringContaining("acepe-investor-pitch.pdf"),
			port: 4173,
		});

		const payload = Buffer.from(await response.arrayBuffer()).toString("utf8");

		expect(payload).toContain("%PDF");
	});
});
