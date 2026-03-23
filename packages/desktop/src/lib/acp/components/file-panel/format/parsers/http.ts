import type { StructuredData } from "../types.js";

export function parseHttpLike(content: string): StructuredData {
	const requests: StructuredData[] = [];
	const blocks = content
		.split(/\n\s*###\s*/g)
		.map((b) => b.trim())
		.filter((b) => b.length > 0);

	for (const block of blocks) {
		const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
		const requestLine = lines[0] ?? "";
		const headerLines: string[] = [];
		const bodyLines: string[] = [];
		let inBody = false;

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (!inBody && line.trim().length === 0) {
				inBody = true;
				continue;
			}

			if (inBody) {
				bodyLines.push(line);
			} else {
				headerLines.push(line);
			}
		}

		requests.push({
			request: requestLine,
			headers: headerLines,
			body: bodyLines.join("\n"),
		});
	}

	return requests;
}
