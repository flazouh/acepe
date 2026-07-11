import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readLinearCacheEntries } from "./chromium-cache.js";
import {
	extractIconsFromCacheEntry,
	geometryHash,
	provisionalCleanName,
} from "./extract-svg-sources.js";
import { cleanIconName } from "./name-utils.js";
import { buildFeatureSvgCoverageReport } from "./feature-svg-candidates.js";
import { normalizeLinearSvg, normalizeRawIcon } from "./normalize-svg.js";
import type {
	LinearIconSourceOccurrence,
	LinearIconInventoryManifest,
	NormalizedLinearIcon,
	RawExtractedIcon,
} from "./types.js";

const DEFAULT_CACHE_PATH = join(
	homedir(),
	"Library/Application Support/Linear/Cache/Cache_Data",
);
const DEFAULT_OUTPUT_DIR = resolve(import.meta.dirname, "inventory");

type BuildInventoryOptions = {
	readonly cachePath?: string;
	readonly outputDir?: string;
};

function resolveCleanName(
	icon: RawExtractedIcon,
	usedNames: Set<string>,
): string {
	const baseName = cleanIconName(icon.originalName);
	if (!usedNames.has(baseName)) {
		return baseName;
	}

	const sourceSuffix = icon.sourceChunk
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
	const suffixedName = `${baseName}-${sourceSuffix}`;
	if (!usedNames.has(suffixedName)) {
		return suffixedName;
	}

	let counter = 2;
	while (usedNames.has(`${baseName}-${counter}`)) {
		counter += 1;
	}
	return `${baseName}-${counter}`;
}

function sortIcons(
	left: NormalizedLinearIcon,
	right: NormalizedLinearIcon,
): number {
	const cleanNameOrder = left.cleanName.localeCompare(right.cleanName);
	if (cleanNameOrder !== 0) {
		return cleanNameOrder;
	}

	const sourceChunkOrder = left.sourceChunk.localeCompare(right.sourceChunk);
	if (sourceChunkOrder !== 0) {
		return sourceChunkOrder;
	}

	return left.originalName.localeCompare(right.originalName);
}

function inventoryHash(manifest: LinearIconInventoryManifest): string {
	const payload = JSON.stringify({
		icons: manifest.icons.map((icon) => ({
			cleanName: icon.cleanName,
			duplicateOf: icon.duplicateOf,
			geometryHash: icon.geometryHash,
			originalName: icon.originalName,
			sourceChunk: icon.sourceChunk,
			sourceType: icon.sourceType,
			sourceSet: icon.sourceSet,
			sourceOccurrences: icon.sourceOccurrences,
			svgFile: icon.svgFile,
			viewBox: icon.viewBox,
		})),
	});
	return createHash("sha256").update(payload).digest("hex");
}

export function buildLinearIconInventory(
	options: BuildInventoryOptions = {},
): LinearIconInventoryManifest {
	const cachePath = options.cachePath ? options.cachePath : DEFAULT_CACHE_PATH;
	const outputDir = options.outputDir ? options.outputDir : DEFAULT_OUTPUT_DIR;
	const svgDir = join(outputDir, "svgs");

	mkdirSync(svgDir, { recursive: true });

	const cacheEntries = readLinearCacheEntries(cachePath);
	const rawIcons: RawExtractedIcon[] = [];

	for (const entry of cacheEntries) {
		const extracted = extractIconsFromCacheEntry(
			entry.assetName,
			entry.sourceText,
		);
		for (const icon of extracted) {
			rawIcons.push(normalizeRawIcon(icon));
		}
	}
	const coverage = buildFeatureSvgCoverageReport(cacheEntries, rawIcons);
	writeFileSync(
		join(outputDir, "coverage.json"),
		`${JSON.stringify(coverage, null, 2)}\n`,
		"utf8",
	);

	const geometryOwners = new Map<string, string>();
	const usedNames = new Set<string>();
	const normalizedIcons: NormalizedLinearIcon[] = [];

	for (const icon of rawIcons.sort(compareRawIconsForCanonicalOwnership)) {
		const hash = geometryHash(icon);
		const cleanName = resolveCleanName(icon, usedNames);
		usedNames.add(cleanName);

		const existingOwner = geometryOwners.get(hash);
		const duplicateOwner = existingOwner === undefined ? null : existingOwner;
		if (!duplicateOwner) {
			geometryOwners.set(hash, cleanName);
		}

		normalizedIcons.push({
			originalName: icon.originalName,
			cleanName,
			sourceChunk: icon.sourceChunk,
			sourceType: icon.sourceType,
			sourceSet: icon.sourceSet,
			viewBox: icon.viewBox,
			geometryHash: hash,
			svg: normalizeLinearSvg(icon),
			duplicateOf: duplicateOwner,
		});
	}

	const sortedIcons = normalizedIcons.sort(sortIcons);
	const occurrencesByGeometry = new Map<string, LinearIconSourceOccurrence[]>();
	for (const icon of sortedIcons) {
		const existingOccurrences = occurrencesByGeometry.get(icon.geometryHash);
		const occurrences =
			existingOccurrences === undefined ? [] : existingOccurrences;
		const occurrenceExists = occurrences.some(
			(occurrence) =>
				occurrence.originalName === icon.originalName &&
				occurrence.sourceChunk === icon.sourceChunk &&
				occurrence.sourceType === icon.sourceType &&
				occurrence.sourceSet === icon.sourceSet,
		);
		if (!occurrenceExists) {
			occurrences.push({
				originalName: icon.originalName,
				sourceChunk: icon.sourceChunk,
				sourceType: icon.sourceType,
				sourceSet: icon.sourceSet,
			});
		}
		occurrencesByGeometry.set(icon.geometryHash, occurrences);
	}
	for (const icon of sortedIcons) {
		if (icon.duplicateOf) {
			continue;
		}
		writeFileSync(
			join(svgDir, `${icon.cleanName}.svg`),
			`${icon.svg}\n`,
			"utf8",
		);
	}

	const manifest: LinearIconInventoryManifest = {
		manifestVersion: 2,
		generatedAt: "1970-01-01T00:00:00.000Z",
		cachePath,
		inventoryHash: "",
		stats: {
			cacheEntriesScanned: cacheEntries.length,
			assetChunksScanned: cacheEntries.filter((entry) =>
				entry.assetName.endsWith(".js"),
			).length,
			iconsExtracted: sortedIcons.length,
			uniqueGeometry: sortedIcons.filter((icon) => icon.duplicateOf === null)
				.length,
			duplicates: sortedIcons.filter((icon) => icon.duplicateOf !== null)
				.length,
		},
		icons: sortedIcons.map((icon) => ({
			id: icon.cleanName,
			originalName: icon.originalName,
			cleanName: icon.cleanName,
			sourceChunk: icon.sourceChunk,
			sourceType: icon.sourceType,
			sourceSet: icon.sourceSet,
			geometryHash: icon.geometryHash,
			viewBox: icon.viewBox,
			svgFile: `svgs/${icon.cleanName}.svg`,
			duplicateOf: icon.duplicateOf,
			sourceOccurrences: occurrencesByGeometry.get(icon.geometryHash) || [],
		})),
	};

	const inventoryHashValue = inventoryHash(manifest);
	const finalManifest: LinearIconInventoryManifest = {
		manifestVersion: manifest.manifestVersion,
		generatedAt: manifest.generatedAt,
		cachePath: manifest.cachePath,
		inventoryHash: inventoryHashValue,
		stats: manifest.stats,
		icons: manifest.icons,
	};

	writeFileSync(
		join(outputDir, "manifest.json"),
		`${JSON.stringify(finalManifest, null, 2)}\n`,
		"utf8",
	);

	return finalManifest;
}

export function compareRawIconsForCanonicalOwnership(
	left: RawExtractedIcon,
	right: RawExtractedIcon,
): number {
	const generatedNamePattern = /^(?:FeatureSvg|SharedJsx)/;
	const generatedNameOrder =
		Number(generatedNamePattern.test(left.originalName)) -
		Number(generatedNamePattern.test(right.originalName));
	if (generatedNameOrder !== 0) {
		return generatedNameOrder;
	}
	const leftFeaturePriority = left.sourceType === "feature-jsx" ? 1 : 0;
	const rightFeaturePriority = right.sourceType === "feature-jsx" ? 1 : 0;
	const featurePriorityOrder = leftFeaturePriority - rightFeaturePriority;
	if (featurePriorityOrder !== 0) {
		return featurePriorityOrder;
	}

	const provisionalLeft = provisionalCleanName(left);
	const provisionalRight = provisionalCleanName(right);
	const cleanNameOrder = provisionalLeft.localeCompare(provisionalRight);
	if (cleanNameOrder !== 0) {
		return cleanNameOrder;
	}
	return left.sourceChunk.localeCompare(right.sourceChunk);
}

if (import.meta.main) {
	const cachePath = process.argv[2];
	const outputDir = process.argv[3];
	const manifest = buildLinearIconInventory({
		cachePath,
		outputDir,
	});

	console.log(
		`Linear icon inventory: ${manifest.stats.uniqueGeometry} unique icons, ${manifest.stats.duplicates} duplicates, ${manifest.stats.iconsExtracted} total entries`,
	);
	console.log(`Inventory hash: ${manifest.inventoryHash}`);
}
