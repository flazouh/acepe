import { describe, expect, it } from "vitest";

import { extractAttachmentsFromChunks } from "../extract-content-attachments.js";

describe("extractAttachmentsFromChunks", () => {
	it("preserves dotfile extensions for resource link attachments", () => {
		const attachments = extractAttachmentsFromChunks([
			{
				type: "resource_link",
				uri: "/repo/.env",
				name: ".env",
			},
		]);

		expect(attachments).toEqual([
			{
				type: "file",
				path: "/repo/.env",
				displayName: ".env",
				extension: "env",
			},
		]);
	});
});
