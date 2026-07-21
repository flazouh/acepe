import { describe, expect, it } from "vitest";

import {
	parseNativeMarkdown,
	type NativeMarkdownBlock,
	type NativeMarkdownInline,
} from "./native-markdown-model.js";

function assertUniqueSiblingKeys(items: readonly { readonly key: string }[]): void {
	const seen = new Set<string>();
	for (const item of items) {
		expect(seen.has(item.key), `duplicate sibling key ${item.key}`).toBe(false);
		seen.add(item.key);
	}
}

function assertUniqueInlineTreeKeys(inlines: readonly NativeMarkdownInline[]): void {
	assertUniqueSiblingKeys(inlines);
	for (const inline of inlines) {
		if (
			inline.type === "link" ||
			inline.type === "strong" ||
			inline.type === "em" ||
			inline.type === "delete"
		) {
			assertUniqueInlineTreeKeys(inline.children);
		}
		if (inline.type === "text") {
			assertUniqueSiblingKeys(inline.parts);
		}
	}
}

function assertUniqueBlockTreeKeys(blocks: readonly NativeMarkdownBlock[]): void {
	assertUniqueSiblingKeys(blocks);
	for (const block of blocks) {
		if (block.type === "paragraph" || block.type === "heading" || block.type === "text") {
			assertUniqueInlineTreeKeys(block.children);
		}
		if (block.type === "list") {
			assertUniqueSiblingKeys(block.items);
			for (const item of block.items) {
				assertUniqueBlockTreeKeys(item.blocks);
			}
		}
		if (block.type === "blockquote") {
			assertUniqueBlockTreeKeys(block.blocks);
		}
		if (block.type === "table") {
			assertUniqueSiblingKeys(block.header);
			for (const cell of block.header) {
				assertUniqueInlineTreeKeys(cell.children);
			}
			for (const row of block.rows) {
				assertUniqueSiblingKeys(row);
				for (const cell of row) {
					assertUniqueInlineTreeKeys(cell.children);
				}
			}
		}
	}
}

describe("parseNativeMarkdown", () => {
	it("generates unique keys for every sibling inline group", () => {
		const document = parseNativeMarkdown(
			"Use the Agent tool exactly once to read README.md and CONTEXT.md, then report README.md again. **README.md** _CONTEXT.md_ https://github.com/flazouh/acepe/issues/1"
		);

		assertUniqueBlockTreeKeys(document.blocks);
	});

	it("keeps counter-minted and word-anchored text keys in separate namespaces", () => {
		// Two independent counters used to mint into one `text:` namespace: the
		// whitespace-only inline between the second and third `**a**` took
		// `nextKey` 3, and the trailing word-bearing inline anchored to document
		// word 3 — both `text:3`, siblings in the same keyed `{#each}`, so Svelte
		// threw each_key_duplicate and the agent panel crashed mid-stream.
		const document = parseNativeMarkdown("**a** **a** **a** a");

		assertUniqueBlockTreeKeys(document.blocks);
	});
});
