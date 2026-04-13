import { describe, expect, it } from "bun:test";

import { createFileTree, flattenFileTree } from "./file-list-logic.js";

describe("file list logic", () => {
	it("dedupes duplicate indexed file paths before flattening", () => {
		const tree = createFileTree([
			{
				path: "packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte",
				extension: "svelte",
				lineCount: 1,
				gitStatus: null,
			},
			{
				path: "packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte",
				extension: "svelte",
				lineCount: 1,
				gitStatus: null,
			},
		]);

		const flattened = flattenFileTree(
			tree,
			new Set<string>([
				"/Users/alex/Documents/acepe:packages",
				"/Users/alex/Documents/acepe:packages/desktop",
				"/Users/alex/Documents/acepe:packages/desktop/src",
				"/Users/alex/Documents/acepe:packages/desktop/src/lib",
				"/Users/alex/Documents/acepe:packages/desktop/src/lib/acp",
				"/Users/alex/Documents/acepe:packages/desktop/src/lib/acp/components",
				"/Users/alex/Documents/acepe:packages/desktop/src/lib/acp/components/session-list",
			]),
			"/Users/alex/Documents/acepe"
		);

		const matchingEntries = flattened.filter(
			({ node }) =>
				node.path === "packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte"
		);

		expect(matchingEntries).toHaveLength(1);
	});
});
