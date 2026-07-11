import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { linearIconInventoryManifestSchema } from "./linear-icon-manifest-schema.js";
import { linearIconCoverageSummarySchema } from "./linear-icon-coverage-schema.js";
import type { GenerateLinearIconCatalogOptions } from "./types/generate-linear-icon-catalog-options.js";
import type { LinearIconCatalogEntry } from "./types/linear-icon-catalog-entry.js";

const packageRoot = resolve(import.meta.dirname);
const defaultInventoryDir = join(packageRoot, "inventory");

export const defaultWebsiteCatalogOutputFile = resolve(
	packageRoot,
	"../../packages/website/src/lib/design-system/linear-icon-catalog.generated.ts",
);

export const defaultUiCatalogOutputFile = resolve(
	packageRoot,
	"../../packages/ui/src/components/icons/linear-icon-catalog.generated.ts",
);

function readAttribute(attributes: string, name: string): string {
	const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
	return match && match[1] ? match[1] : "";
}

function svgInner(svg: string): string {
	return svg
		.replace(/^<svg\b[^>]*>/s, "")
		.replace(/<\/svg>\s*$/s, "")
		.trim();
}

function formatIconLabel(name: string): string {
	return name
		.split("-")
		.map((part) => {
			if (part.length === 0) {
				return part;
			}
			const firstCharacter = part[0];
			return `${firstCharacter ? firstCharacter.toUpperCase() : ""}${part.slice(1)}`;
		})
		.join(" ");
}

function readSvgEntry(
	svgPath: string,
	cleanName: string,
): { viewBox: string; inner: string } {
	const svg = readFileSync(svgPath, "utf8").trim();
	const match = svg.match(/^<svg\b([^>]*)>/s);
	if (!match) {
		throw new Error(`Missing <svg> wrapper in ${svgPath}`);
	}

	const svgAttributes = match[1] ? match[1] : "";
	const viewBox = readAttribute(svgAttributes, "viewBox");
	if (!viewBox) {
		throw new Error(`Missing viewBox in ${svgPath}`);
	}

	return {
		viewBox,
		inner: svgInner(svg),
	};
}

function catalogHash(entries: readonly LinearIconCatalogEntry[]): string {
	const payload = entries.map((entry) => ({
		inner: entry.inner,
		name: entry.name,
		sourceChunk: entry.sourceChunk,
		sourceType: entry.sourceType,
		sourceSet: entry.sourceSet,
		sourceOccurrences: entry.sourceOccurrences,
		geometryHash: entry.geometryHash,
		viewBox: entry.viewBox,
	}));
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function parseCliArgs(
	argv: readonly string[],
): GenerateLinearIconCatalogOptions {
	const options: GenerateLinearIconCatalogOptions = {};

	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output" || arg === "-o") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --output");
			}
			options.outputFile = value;
			index += 1;
			continue;
		}
		if (arg === "--inventory" || arg === "-i") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --inventory");
			}
			options.inventoryDir = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

export function generateLinearIconCatalog(
	options: GenerateLinearIconCatalogOptions = {},
): {
	readonly catalogHash: string;
	readonly iconCount: number;
	readonly outputFile: string;
} {
	const inventoryDir = options.inventoryDir
		? options.inventoryDir
		: defaultInventoryDir;
	const outputFile = options.outputFile
		? options.outputFile
		: defaultWebsiteCatalogOutputFile;
	const manifestPath = join(inventoryDir, "manifest.json");
	const coveragePath = join(inventoryDir, "coverage.json");
	const parsedManifest = linearIconInventoryManifestSchema.safeParse(
		JSON.parse(readFileSync(manifestPath, "utf8")),
	);
	if (!parsedManifest.success) {
		throw new Error("Linear icon catalog requires a valid manifest version 2");
	}
	const manifest = parsedManifest.data;
	const parsedCoverage = linearIconCoverageSummarySchema.safeParse(
		JSON.parse(readFileSync(coveragePath, "utf8")),
	);
	if (!parsedCoverage.success) {
		throw new Error("Linear icon catalog requires a valid coverage report");
	}
	const coverage = parsedCoverage.data;
	const ownerByGeometry = new Map(
		manifest.icons
			.filter((icon) => icon.duplicateOf === null)
			.map((icon) => [icon.geometryHash, icon] as const),
	);
	const selectedAliasKeys = new Set<string>();
	const semanticAliases = manifest.icons
		.filter(
			(icon) =>
				icon.duplicateOf !== null &&
				icon.sourceType === "feature-jsx" &&
				!icon.originalName.startsWith("FeatureSvg"),
		)
		.sort((left, right) => {
			const lengthOrder = left.cleanName.length - right.cleanName.length;
			return lengthOrder === 0
				? left.cleanName.localeCompare(right.cleanName)
				: lengthOrder;
		})
		.filter((icon) => {
			const aliasKey = `${icon.originalName}:${icon.geometryHash}`;
			if (selectedAliasKeys.has(aliasKey)) {
				return false;
			}
			selectedAliasKeys.add(aliasKey);
			return true;
		});
	const catalogIcons = manifest.icons
		.filter((icon) => icon.duplicateOf === null)
		.concat(semanticAliases);

	const entries: LinearIconCatalogEntry[] = catalogIcons
		.map((icon) => {
			const geometryOwner = ownerByGeometry.get(icon.geometryHash);
			if (!geometryOwner) {
				throw new Error(`Missing geometry owner for ${icon.cleanName}`);
			}
			const svgPath = join(inventoryDir, geometryOwner.svgFile);
			const svgEntry = readSvgEntry(svgPath, icon.cleanName);
			return {
				name: icon.cleanName,
				label: formatIconLabel(icon.cleanName),
				sourceChunk: icon.sourceChunk,
				sourceType: icon.sourceType,
				sourceSet: icon.sourceSet,
				sourceOccurrences: icon.sourceOccurrences,
				geometryHash: icon.geometryHash,
				viewBox: svgEntry.viewBox,
				inner: svgEntry.inner,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));

	const hash = catalogHash(entries);
	const iconNameLines = entries.map(
		(entry) => `\t${JSON.stringify(entry.name)},`,
	);
	const iconDataLines = entries.map(
		(entry) =>
			`\t${JSON.stringify(entry.name)}: { viewBox: ${JSON.stringify(entry.viewBox)}, inner: ${JSON.stringify(entry.inner)}, label: ${JSON.stringify(entry.label)}, sourceChunk: ${JSON.stringify(entry.sourceChunk)}, sourceType: ${JSON.stringify(entry.sourceType)}, sourceSet: ${JSON.stringify(entry.sourceSet)}, sourceOccurrences: ${JSON.stringify(entry.sourceOccurrences)}, geometryHash: ${JSON.stringify(entry.geometryHash)} },`,
	);
	const libraryLines = entries.map(
		(entry) =>
			`\t{ name: ${JSON.stringify(entry.name)}, label: ${JSON.stringify(entry.label)}, sourceChunk: ${JSON.stringify(entry.sourceChunk)}, sourceType: ${JSON.stringify(entry.sourceType)}, sourceSet: ${JSON.stringify(entry.sourceSet)}, sourceOccurrences: ${JSON.stringify(entry.sourceOccurrences)}, fileName: ${JSON.stringify(`${entry.name}.svg`)} },`,
	);

	const output = `// Generated by scripts/linear-icons/generate-website-icon-catalog.ts.
// Source: scripts/linear-icons/inventory (${entries.length} unique Linear-derived icons).

export const linearIconCatalogHash = ${JSON.stringify(hash)};

export const linearIconCoverage = ${JSON.stringify(coverage)} as const;

export const linearIconNames = [
${iconNameLines.join("\n")}
] as const;

export const linearIconData = {
${iconDataLines.join("\n")}
} as const;

export const linearIconLibrary = [
${libraryLines.join("\n")}
] as const;
`;

	mkdirSync(resolve(outputFile, ".."), { recursive: true });
	writeFileSync(outputFile, output);

	return {
		catalogHash: hash,
		iconCount: entries.length,
		outputFile,
	};
}

/** @deprecated Use generateLinearIconCatalog instead. */
export const generateWebsiteIconCatalog = generateLinearIconCatalog;

if (import.meta.main) {
	const result = generateLinearIconCatalog(parseCliArgs(process.argv));
	console.log(
		`Generated ${result.iconCount} Linear icons at ${result.outputFile}`,
	);
	console.log(`Catalog hash: ${result.catalogHash}`);
}
