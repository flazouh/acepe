import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPitchUrl,
	exportPitchPdf,
	waitForPitchReady,
} from "../../../../scripts/export-pitch-pdf.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const tempDirectory = await mkdtemp(join(tmpdir(), "acepe-pitch-"));
	const outputPath = join(tempDirectory, "acepe-investor-pitch.pdf");
	const pitchUrl = createPitchUrl(url.origin);

	try {
		await waitForPitchReady(pitchUrl);
		await exportPitchPdf(pitchUrl, outputPath);

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
