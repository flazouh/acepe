import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { parseChromiumSimpleCacheEntry } from "../chromium-cache.js";
import { extractIconsFromCacheEntry } from "../extract-svg-sources.js";
import { enumerateFeatureSvgCandidates } from "../feature-svg-candidates.js";
import { buildFeatureSvgCoverageReport } from "../feature-svg-candidates.js";
import { normalizeLinearSvg, normalizeRawIcon } from "../normalize-svg.js";
import { cleanIconName } from "../name-utils.js";
import { isDedicatedIconChunk } from "../name-utils.js";
import {
	buildLinearIconInventory,
	compareRawIconsForCanonicalOwnership,
} from "../extract-linear-icons.js";
import { geometryHash } from "../icon-geometry.js";
import { generateLinearIconCatalog } from "../generate-website-icon-catalog.js";

const fixtureDir = join(import.meta.dirname, "fixtures");
const closeIconFixture = readFileSync(
	join(fixtureDir, "close-icon-cache-entry.bin"),
);
const rootSpriteFixture = readFileSync(
	join(fixtureDir, "root-sprite-cache-entry.bin"),
);
const pullRequestStatusFixture = readFileSync(
	join(fixtureDir, "pull-request-status-icon.js"),
	"utf8",
);
const agentToolbarCopyIdFixture = readFileSync(
	join(fixtureDir, "agent-toolbar-copy-id.js"),
	"utf8",
);

type ExclusionAudit = {
	readonly corpusHash: string;
	readonly samples: readonly {
		readonly reason: string;
		readonly candidateId: string;
		readonly sourceFingerprint: string;
	}[];
};

describe("linear icon inventory", () => {
	test("audits a real corpus row for every exclusion reason before coverage is complete", () => {
		const coverage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../inventory/coverage.json"), "utf8"),
		) as {
			readonly complete: boolean;
			readonly corpusHash: string;
			readonly candidates: readonly {
				readonly status: string;
				readonly reason: string;
				readonly candidateId: string;
				readonly sourceFingerprint: string;
			}[];
		};
		const audit = JSON.parse(
			readFileSync(join(import.meta.dirname, "../exclusion-audit.json"), "utf8"),
		) as ExclusionAudit;
		const exclusionReasons = new Set(
			coverage.candidates
				.filter((candidate) => candidate.status === "excluded")
				.map((candidate) => candidate.reason),
		);

		expect(coverage.complete).toBe(true);
		expect(audit.corpusHash).toBe(coverage.corpusHash);
		expect(new Set(audit.samples.map((sample) => sample.reason))).toEqual(
			exclusionReasons,
		);
		for (const sample of audit.samples) {
			expect(coverage.candidates).toContainEqual(
				expect.objectContaining({
					status: "excluded",
					reason: sample.reason,
					candidateId: sample.candidateId,
					sourceFingerprint: sample.sourceFingerprint,
				}),
			);
		}
	});
	test("recognizes Linear's explicit large icon chunks", () => {
		expect(isDedicatedIconChunk("ExpandChevronIconLarge.Cc8RM74O.js")).toBe(
			true,
		);
		expect(isDedicatedIconChunk("CollapseChevronIconLarge.DYrpKP7g.js")).toBe(
			true,
		);
	});
	test("parses Chromium simple cache entries from Linear fixtures", () => {
		const closeEntry = parseChromiumSimpleCacheEntry(closeIconFixture);
		expect(closeEntry).not.toBeNull();
		expect(closeEntry?.urlKey).toContain("CloseIcon.CKJGMQ3V.js");
		expect(closeEntry?.contentEncoding).toBe("br");
		expect(closeEntry?.sourceText).toContain("jsx");

		const rootEntry = parseChromiumSimpleCacheEntry(rootSpriteFixture);
		expect(rootEntry).not.toBeNull();
		expect(rootEntry?.urlKey).toContain("Root.BBtwZL7v.js");
		expect(rootEntry?.sourceText).toContain('<symbol id="Accessibility"');
	});

	test("extracts dedicated and sprite icons with normalized SVG output", () => {
		const closeEntry = parseChromiumSimpleCacheEntry(closeIconFixture);
		expect(closeEntry).not.toBeNull();
		if (!closeEntry) {
			return;
		}

		const closeIcons = extractIconsFromCacheEntry(
			"CloseIcon.CKJGMQ3V.js",
			closeEntry.sourceText,
		);
		expect(closeIcons).toHaveLength(1);
		expect(closeIcons[0]?.originalName).toBe("CloseIcon");
		expect(closeIcons[0]?.sourceType).toBe("dedicated-chunk");

		const normalizedClose = normalizeRawIcon(
			closeIcons[0] as NonNullable<(typeof closeIcons)[0]>,
		);
		const closeSvg = normalizeLinearSvg(normalizedClose);
		expect(closeSvg).toContain('viewBox="0 0 16 16"');
		expect(closeSvg).toContain('fill="currentColor"');
		expect(cleanIconName("CloseIcon")).toBe("close");

		const rootEntry = parseChromiumSimpleCacheEntry(rootSpriteFixture);
		expect(rootEntry).not.toBeNull();
		if (!rootEntry) {
			return;
		}

		const spriteIcons = extractIconsFromCacheEntry(
			"Root.BBtwZL7v.js",
			rootEntry.sourceText,
		);
		expect(spriteIcons.length).toBeGreaterThan(250);
		expect(
			spriteIcons.find((icon) => icon.originalName === "Attachment"),
		).toMatchObject({
			sourceSet: "base",
		});
		expect(
			spriteIcons.find((icon) => icon.originalName === "Anthropic"),
		).toMatchObject({
			sourceSet: "brands",
		});
		expect(
			spriteIcons.find((icon) => icon.originalName === "Accessibility"),
		).toMatchObject({
			sourceSet: "decorative",
		});
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
		expect(first.manifestVersion).toBe(2);
		expect(first.stats.uniqueGeometry).toBeGreaterThan(250);
		expect(first.stats.duplicates).toBeGreaterThanOrEqual(0);
		expect(first.icons.some((icon) => icon.cleanName === "close")).toBe(true);
		const accessibility = first.icons.find(
			(icon) => icon.cleanName === "accessibility",
		);
		expect(accessibility?.sourceSet).toBe("decorative");
		expect(accessibility?.sourceOccurrences).toEqual([
			expect.objectContaining({
				originalName: "Accessibility",
				sourceSet: "decorative",
			}),
		]);
	});

	test("rejects obsolete manifests before catalog generation", () => {
		const inventoryDir = mkdtempSync(join(tmpdir(), "linear-icon-v1-"));
		writeFileSync(
			join(inventoryDir, "manifest.json"),
			JSON.stringify({ manifestVersion: 1, icons: [] }),
			"utf8",
		);

		expect(() =>
			generateLinearIconCatalog({
				inventoryDir,
				outputFile: join(inventoryDir, "catalog.ts"),
			}),
		).toThrow("manifest version 2");
	});

	test("keeps unnamed compact SVG geometry visible for review", () => {
		const fakeInputBundle = `
			import{n as e}from"./vendor-react.js";
			function Input(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:\`M3.46975 5.70757L1.88358 4.1225\`})})}
			function Checkbox(){return(0,o.jsx)(\`rect\`,{y:\`0.25\`,width:\`6\`,height:\`1.5\`,fill:\`currentColor\`})}
		`;
		const extracted = extractIconsFromCacheEntry(
			"Input.Qu5w9aCc.js",
			fakeInputBundle,
		);
		expect(extracted).toHaveLength(1);
		expect(extracted[0]).toMatchObject({
			originalName: expect.stringMatching(/^FeatureSvg[0-9a-f]+Icon$/),
			sourceChunk: "Input",
			sourceType: "feature-jsx",
		});
	});

	test("extracts SVG rects that use the standard zero position defaults", () => {
		const sourceText = `
			function Separator(){return(0,o.jsx)(\`svg\`,{viewBox:\`0 0 6 2\`,children:(0,o.jsx)(\`rect\`,{y:\`0.25\`,width:\`6\`,height:\`1.5\`})})}
		`;
		const extracted = extractIconsFromCacheEntry("Input.js", sourceText);
		const featureIcon = extracted.find((icon) =>
			icon.originalName.startsWith("FeatureSvg"),
		);

		expect(featureIcon?.shapes).toEqual([
			expect.objectContaining({
				tag: "rect",
				attributes: expect.objectContaining({
					y: "0.25",
					width: "6",
					height: "1.5",
				}),
			}),
		]);
	});

	test("extracts shapes rendered through a local SVG primitive wrapper", () => {
		const sourceText = `
			function AnimatedPath(props){return(0,o.jsx)(\`path\`,{...props})}
			function Folder(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(AnimatedPath,{d:\`M3 2H6L9 5\`})})}
		`;
		const extracted = extractIconsFromCacheEntry("Folder.js", sourceText);
		const featureIcon = extracted.find((icon) =>
			icon.originalName.startsWith("FeatureSvg"),
		);

		expect(featureIcon?.shapes).toEqual([
			expect.objectContaining({
				tag: "path",
				attributes: expect.objectContaining({ d: "M3 2H6L9 5" }),
			}),
		]);
	});

	test("extracts path data from a direct module literal binding", () => {
		const sourceText = `
			var RESIZE_PATH=\`M4 3L13 6L7 10Z\`;
			function ResizeIcon(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:RESIZE_PATH})})}
		`;
		const extracted = extractIconsFromCacheEntry("ResizeIcon.js", sourceText);
		const featureIcon = extracted.find((icon) =>
			icon.originalName.startsWith("FeatureSvg"),
		);

		expect(featureIcon?.shapes).toEqual([
			expect.objectContaining({
				tag: "path",
				attributes: expect.objectContaining({ d: "M4 3L13 6L7 10Z" }),
			}),
		]);
	});

	test("extracts action-bound Copy ID geometry from a feature bundle", () => {
		const extracted = extractIconsFromCacheEntry(
			"AgentToolbarActions.DNMTr2dR.js",
			agentToolbarCopyIdFixture,
		);

		const copyId = extracted.find((icon) => icon.originalName === "CopyIdIcon");
		expect(copyId).toEqual(
			expect.objectContaining({
				originalName: "CopyIdIcon",
				sourceChunk: "AgentToolbarActions",
				sourceType: "feature-jsx",
				viewBox: "0 0 16 16",
				shapes: expect.arrayContaining([
					expect.objectContaining({ tag: "path" }),
					expect.objectContaining({ tag: "path" }),
				]),
			}),
		);
		expect(copyId?.shapes).toHaveLength(2);
	});

	test("enumerates feature SVG candidates independently from semantic extraction", () => {
		const candidates = enumerateFeatureSvgCandidates(
			"AgentToolbarActions.DNMTr2dR.js",
			agentToolbarCopyIdFixture,
		);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			assetName: "AgentToolbarActions.DNMTr2dR.js",
			ownerName: "bS",
			status: "candidate",
		});
		expect(candidates[0]?.sourceFingerprint).toHaveLength(64);
	});

	test("counts dedicated icon candidates as extracted by their geometry", () => {
		const sourceText = `
			function AddRelationIcon(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:\`M3.75 1.04v12.476\`})})}
		`;
		const assetName = "AddRelationIcon.Bi-i4EuG.js";
		const extractedIcons = extractIconsFromCacheEntry(assetName, sourceText);
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractedIcons,
		);

		expect(report.stats).toMatchObject({
			candidates: 1,
			extracted: 1,
			needsReview: 0,
		});
		expect(report.candidates[0]).toMatchObject({
			status: "extracted",
			reason: "recognized-extraction-path",
		});
	});

	test("excludes static SVG illustrations with an explicit non-icon viewBox", () => {
		const sourceText = `
			function EmptyState(){return(0,o.jsx)(\`svg\`,{viewBox:\`0 0 120 81\`,children:(0,o.jsx)(\`path\`,{d:\`M37 31L80 36\`})})}
		`;
		const assetName = "AutomationRunsPage.BohKLcL9.js";
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractIconsFromCacheEntry(assetName, sourceText),
		);

		expect(report.stats).toMatchObject({
			candidates: 1,
			extracted: 0,
			excluded: 1,
			needsReview: 0,
		});
		expect(report.candidates[0]).toMatchObject({
			status: "excluded",
			reason: "explicit-non-icon-viewbox",
		});
	});

	test("excludes size-dependent progress visualizations", () => {
		const sourceText = `
			function Progress({size}){return(0,o.jsx)(\`svg\`,{viewBox:\`0 0 \${size} \${size}\`,children:(0,o.jsx)(\`circle\`,{cx:size,cy:size,r:1})})}
		`;
		const assetName = "Progress.js";
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractIconsFromCacheEntry(assetName, sourceText),
		);

		expect(report.stats).toMatchObject({ excluded: 1, needsReview: 0 });
		expect(report.candidates[0]).toMatchObject({
			status: "excluded",
			reason: "runtime-generated-visualization",
		});
	});

	test("extracts static compact shapes with numeric attributes and nested style", () => {
		const sourceText = `
			function Status(){return(0,o.jsxs)(\`svg\`,{children:[
				(0,o.jsx)(\`path\`,{d:\`M3 3L13 13\`,strokeWidth:2,style:{fill:\`none\`}}),
				(0,o.jsx)(\`circle\`,{cx:8,cy:8,r:3})
			]})}
		`;
		const extracted = extractIconsFromCacheEntry("Status.js", sourceText);
		const featureIcon = extracted.find((icon) =>
			icon.originalName.startsWith("FeatureSvg"),
		);

		expect(featureIcon?.shapes).toEqual([
			expect.objectContaining({
				tag: "path",
				attributes: expect.objectContaining({
					d: "M3 3L13 13",
					"stroke-width": "2",
				}),
			}),
			expect.objectContaining({
				tag: "circle",
				attributes: expect.objectContaining({ cx: "8", cy: "8", r: "3" }),
			}),
		]);
	});

	test("excludes SVG wrappers that own no native geometry", () => {
		const sourceText = `
			function DecorativeWrapper({children}){return(0,o.jsx)(\`svg\`,{fill:\`currentColor\`,children})}
		`;
		const assetName = "DecorativeIcon.js";
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractIconsFromCacheEntry(assetName, sourceText),
		);

		expect(report.stats).toMatchObject({ excluded: 1, needsReview: 0 });
		expect(report.candidates[0]).toMatchObject({
			status: "excluded",
			reason: "svg-wrapper-without-owned-geometry",
		});
	});

	test("keeps native paths with unresolved geometry in review", () => {
		const sourceText = `
			function ResizeIcon(){return(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:EXTERNAL_PATH})})}
		`;
		const assetName = "ResizeIcon.js";
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractIconsFromCacheEntry(assetName, sourceText),
		);

		expect(report.stats).toMatchObject({ excluded: 0, needsReview: 1 });
	});

	test("excludes SVG visualizations generated by runtime loops", () => {
		const sourceText = `
			function GridLoader(){return(0,o.jsx)(\`svg\`,{viewBox:\`0 0 16 16\`,children:Array.from({length:25}).map((_,index)=>(0,o.jsx)(\`circle\`,{cx:index,cy:index,r:1}))})}
		`;
		const assetName = "GridLoaderProgressIcon.js";
		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extractIconsFromCacheEntry(assetName, sourceText),
		);

		expect(report.stats).toMatchObject({ excluded: 1, needsReview: 0 });
		expect(report.candidates[0]).toMatchObject({
			status: "excluded",
			reason: "runtime-generated-visualization",
		});
	});

	test("does not mark partially extracted conditional geometry complete", () => {
		const sourceText = `
			function StateRenderer({active}){return(0,o.jsxs)(\`svg\`,{children:[
				(0,o.jsx)(\`circle\`,{cx:8,cy:8,r:3}),
				(0,o.jsx)(\`path\`,{d:active?\`M1 1L5 5\`:\`M1 5L5 1\`})
			]})}
		`;
		const assetName = "StateRenderer.js";
		const extracted = extractIconsFromCacheEntry(assetName, sourceText);
		expect(extracted.some((icon) => icon.shapes.length === 1)).toBe(true);

		const report = buildFeatureSvgCoverageReport(
			[
				{
					cacheFile: "fixture",
					urlKey: `https://static.linear.app/client/assets/${assetName}`,
					assetName,
					contentEncoding: "identity",
					sourceText,
				},
			],
			extracted,
		);

		expect(report.stats).toMatchObject({
			extracted: 0,
			excluded: 1,
			needsReview: 0,
		});
		expect(report.candidates[0]).toMatchObject({
			status: "excluded",
			reason: "runtime-generated-visualization",
		});
	});

	test("splits dedicated icon chunks with multiple svg variants", () => {
		const extracted = extractIconsFromCacheEntry(
			"PullRequestStatusIcon.B6yQ2qNh.js",
			pullRequestStatusFixture,
		);
		const dedicatedIcons = extracted.filter(
			(icon) => icon.sourceType === "dedicated-chunk",
		);
		expect(dedicatedIcons.length).toBeGreaterThan(1);
		expect(dedicatedIcons.every((icon) => icon.shapes.length <= 5)).toBe(true);
		expect(dedicatedIcons.some((icon) => icon.shapes.length === 1)).toBe(true);

		const normalizedIcons = dedicatedIcons.map((icon) =>
			normalizeLinearSvg(normalizeRawIcon(icon)),
		);
		for (const svg of normalizedIcons) {
			const pathElements = svg.match(/<path/g);
			expect(
				pathElements === null ? 0 : pathElements.length,
			).toBeLessThanOrEqual(5);
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

			const svg = readFileSync(
				join(fixtureDir, "output-c", icon.svgFile),
				"utf8",
			);
			const pathMatches = Array.from(svg.matchAll(/d="([^"]*)"/g));
			for (const match of pathMatches) {
				const pathData = match[1] ? match[1] : "";
				expect(pathData).not.toMatch(/\d\.\d+\d\.\d/);
				expect(pathData).not.toContain("0.50.5");
			}
		}
	});

	test("gives semantic component names canonical ownership over generated aliases", () => {
		const sourceText = `
			function Fm(e){return(0,o.jsx)(\`svg\`,{viewBox:\`0 0 16 16\`,children:(0,o.jsx)(\`path\`,{d:\`M3 6.5a1.5 1.5 0 1 1 0 3\`})})}
		`;
		const extracted = extractIconsFromCacheEntry(
			"useIsMounted.Test.js",
			sourceText,
		);
		const sameGeometry = extracted.filter(
			(icon) => geometryHash(icon) === geometryHash(extracted[0]!),
		);
		sameGeometry.sort(compareRawIconsForCanonicalOwnership);

		expect(sameGeometry.map((icon) => icon.originalName)).toEqual([
			"HorizontalEllipsisIcon",
			expect.stringMatching(/^FeatureSvg/),
		]);
	});

	test("prefers traced shared components over nearby feature action labels", () => {
		const sourceText = `
			function wt(e){return(0,o.jsx)(U,{...e,children:(0,o.jsx)(\`svg\`,{children:(0,o.jsx)(\`path\`,{d:\`M7 2.5H14.75\`})})})}
			const action={name:\`Dim\`,image:(0,o.jsx)(wt,{})};
		`;
		const extracted = extractIconsFromCacheEntry(
			"RegisterAction.Test.js",
			sourceText,
		);
		const displayOptions = extracted.find(
			(icon) => icon.originalName === "DisplayOptionsIcon",
		);
		expect(displayOptions).toBeDefined();
		const sameGeometry = extracted.filter(
			(icon) => geometryHash(icon) === geometryHash(displayOptions!),
		);
		sameGeometry.sort(compareRawIconsForCanonicalOwnership);

		expect(sameGeometry[0]?.originalName).toBe("DisplayOptionsIcon");
	});
});
