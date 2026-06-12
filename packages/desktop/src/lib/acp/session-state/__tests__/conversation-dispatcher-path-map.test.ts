import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CONVERSATION_DISPATCHER_PATH_MAP,
	MATERIALIZER_CHARACTERIZATION_TEST_TITLES,
	R4_INVARIANT_CROSS_REFS,
	SCENE_PATCH_PIN_TEST_TITLES,
} from "./conversation-dispatcher-path-map.js";

const MATERIALIZER_TEST_PATH = fileURLToPath(
	new URL("./agent-panel-graph-materializer.test.ts", import.meta.url)
);

function extractItTitles(source: string): string[] {
	const titles: string[] = [];
	const pattern = /\bit\(\s*"([^"]+)"/g;
	let match = pattern.exec(source);
	while (match !== null) {
		titles.push(match[1]);
		match = pattern.exec(source);
	}
	return titles;
}

describe("conversation dispatcher path map", () => {
	it("maps all 74 materializer characterization cases exactly once", () => {
		const source = readFileSync(MATERIALIZER_TEST_PATH, "utf8");
		const materializerTitles = extractItTitles(source).filter(
			(title) => !SCENE_PATCH_PIN_TEST_TITLES.includes(title)
		);

		expect(materializerTitles).toHaveLength(74);
		expect(MATERIALIZER_CHARACTERIZATION_TEST_TITLES).toHaveLength(74);

		const mappedTitles = [...MATERIALIZER_CHARACTERIZATION_TEST_TITLES].sort();
		const actualTitles = [...materializerTitles].sort();
		expect(mappedTitles).toEqual(actualTitles);

		const duplicateMapped = MATERIALIZER_CHARACTERIZATION_TEST_TITLES.filter(
			(title, index, titles) => titles.indexOf(title) !== index
		);
		expect(duplicateMapped).toEqual([]);
	});

	it("documents every dispatcher path with at least one characterization case", () => {
		for (const [path, titles] of Object.entries(CONVERSATION_DISPATCHER_PATH_MAP)) {
			expect(titles.length).toBeGreaterThan(0);
			expect(path).not.toBe("");
		}
	});

	it("records mandated R4 invariant cross-references", () => {
		expect(R4_INVARIANT_CROSS_REFS.mergedAssistantRowIdJoin).toContain(
			"assistant merging shifts display indexes"
		);
		expect(R4_INVARIANT_CROSS_REFS.missingDisplayRow).toContain("missing display rows");
		expect(R4_INVARIANT_CROSS_REFS.degradedOperationRow).toContain(
			"explicit degraded presentation"
		);
	});
});
