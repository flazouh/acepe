import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { parseChromiumSimpleCacheEntry } from "../chromium-cache.js";
import { extractIconsFromCacheEntry } from "../extract-svg-sources.js";
import { normalizeLinearSvg, normalizeRawIcon } from "../normalize-svg.js";
import { cleanIconName } from "../name-utils.js";
import { buildLinearIconInventory } from "../extract-linear-icons.js";

const fixtureDir = join(import.meta.dirname, "fixtures");
const closeIconFixture = readFileSync(join(fixtureDir, "close-icon-cache-entry.bin"));
const rootSpriteFixture = readFileSync(join(fixtureDir, "root-sprite-cache-entry.bin"));
const pullRequestStatusFixture = readFileSync(
	join(fixtureDir, "pull-request-status-icon.js"),
	"utf8",
);

describe("linear icon inventory", () => {
	test("parses Chromium simple cache entries from Linear fixtures", () => {
		const closeEntry = parseChromiumSimpleCacheEntry(closeIconFixture);
		expect(closeEntry).not.toBeNull();
		expect(closeEntry?.urlKey).toContain("CloseIcon.CKJGMQ3V.js");
		expect(closeEntry?.contentEncoding).toBe("br");
		expect(closeEntry?.sourceText).toContain("jsx");

		const rootEntry = parseChromiumSimpleCacheEntry(rootSpriteFixture);
		expect(rootEntry).not.toBeNull();
		expect(rootEntry?.urlKey).toContain("Root.BBtwZL7v.js");
		expect(rootEntry?.sourceText).toContain("<symbol id=\"Accessibility\"");
	});

	test("extracts dedicated and sprite icons with normalized SVG output", () => {
		const closeEntry = parseChromiumSimpleCacheEntry(closeIconFixture);
		expect(closeEntry).not.toBeNull();
		if (!closeEntry) {
			return;
		}

		const closeIcons = extractIconsFromCacheEntry("CloseIcon.CKJGMQ3V.js", closeEntry.sourceText);
		expect(closeIcons).toHaveLength(1);
		expect(closeIcons[0]?.originalName).toBe("CloseIcon");
		expect(closeIcons[0]?.sourceType).toBe("dedicated-chunk");

		const normalizedClose = normalizeRawIcon(closeIcons[0] as NonNullable<(typeof closeIcons)[0]>);
		const closeSvg = normalizeLinearSvg(normalizedClose);
		expect(closeSvg).toContain('viewBox="0 0 16 16"');
		expect(closeSvg).toContain('fill="currentColor"');
		expect(cleanIconName("CloseIcon")).toBe("close");

		const rootEntry = parseChromiumSimpleCacheEntry(rootSpriteFixture);
		expect(rootEntry).not.toBeNull();
		if (!rootEntry) {
			return;
		}

		const spriteIcons = extractIconsFromCacheEntry("Root.BBtwZL7v.js", rootEntry.sourceText);
		expect(spriteIcons.length).toBeGreaterThan(250);
		expect(spriteIcons.some((icon) => icon.originalName === "IssueStatusBacklog")).toBe(true);
	});

	test("builds a deterministic manifest from fixture cache entries", () => {
		const first = buildLinearIconInventory({
			cachePath: fixtureDir,
			outputDir: join(fixtureDir, "output-a"),
		});
		const second = buildLinearIconInventory({
			cachePath: fixtureDir,
			outputDir: join(fixtureDir, "output-b"),
		});

		expect(first.inventoryHash).toBe(second.inventoryHash);
		expect(first.stats.uniqueGeometry).toBeGreaterThan(250);
		expect(first.stats.duplicates).toBeGreaterThanOrEqual(0);
		expect(first.icons.some((icon) => icon.cleanName === "close")).toBe(true);
	});

	test("does not extract icons from non-icon UI component bundles", () => {
		const fakeInputBundle = `
			import{n as e}from"./vendor-react.js";
			function Input(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:\`M3.46975 5.70757L1.88358 4.1225\`})})}
			function Checkbox(){return(0,o.jsx)(\`rect\`,{y:\`0.25\`,width:\`6\`,height:\`1.5\`,fill:\`currentColor\`})}
		`;
		const extracted = extractIconsFromCacheEntry("Input.Qu5w9aCc.js", fakeInputBundle);
		expect(extracted).toHaveLength(0);
	});

	test("splits dedicated icon chunks with multiple svg variants", () => {
		const extracted = extractIconsFromCacheEntry(
			"PullRequestStatusIcon.B6yQ2qNh.js",
			pullRequestStatusFixture,
		);
		const dedicatedIcons = extracted.filter((icon) => icon.sourceType === "dedicated-chunk");
		expect(dedicatedIcons.length).toBeGreaterThan(1);
		expect(dedicatedIcons.every((icon) => icon.shapes.length <= 5)).toBe(true);
		expect(dedicatedIcons.some((icon) => icon.shapes.length === 1)).toBe(true);

		const normalizedIcons = dedicatedIcons.map((icon) => normalizeLinearSvg(normalizeRawIcon(icon)));
		for (const svg of normalizedIcons) {
			expect((svg.match(/<path/g) ?? []).length).toBeLessThanOrEqual(5);
		}
	});

	test("does not emit mashed decimal sequences in generated svg paths", () => {
		const manifest = buildLinearIconInventory({
			cachePath: fixtureDir,
			outputDir: join(fixtureDir, "output-c"),
		});

		for (const icon of manifest.icons) {
			if (icon.duplicateOf) {
				continue;
			}

			const svg = readFileSync(join(fixtureDir, "output-c", icon.svgFile), "utf8");
			const pathMatches = [...svg.matchAll(/d="([^"]*)"/g)];
			for (const match of pathMatches) {
				const pathData = match[1] ?? "";
				expect(pathData).not.toMatch(/\d\.\d+\d\.\d/);
				expect(pathData).not.toContain("0.50.5");
			}
		}
	});
});
