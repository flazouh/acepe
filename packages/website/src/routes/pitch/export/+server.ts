import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPitchPdf } from "../../../../scripts/export-pitch-pdf.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const tempDirectory = await mkdtemp(join(tmpdir(), "acepe-pitch-"));
	const outputPath = join(tempDirectory, "acepe-investor-pitch.pdf");
	const requestedPort = Number.parseInt(url.port, 10);
	const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 4173;

	try {
		await exportPitchPdf({
			baseUrl: url.origin,
			outputPath,
			port,
		});

		const pdf = await readFile(outputPath);

		return new Response(pdf, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": 'attachment; filename="acepe-investor-pitch.pdf"',
				"Cache-Control": "no-store",
			},
		});
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
};
