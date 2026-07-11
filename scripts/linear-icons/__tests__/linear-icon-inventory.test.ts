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
});
