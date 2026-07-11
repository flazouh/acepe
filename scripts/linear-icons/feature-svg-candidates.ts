import { createHash } from "node:crypto";

import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

import type { FeatureSvgCandidate } from "./types/feature-svg-candidate.js";
import type { FeatureSvgCoverageReport } from "./types/feature-svg-coverage-report.js";
import type { FeatureSvgCoverageRow } from "./types/feature-svg-coverage-row.js";
import type { LinearCacheEntry } from "./types/linear-cache-entry.js";
import type { RawExtractedIcon } from "./types/raw-extracted-icon.js";
import { assetBaseName, isDedicatedIconChunk } from "./name-utils.js";
import { geometryHash } from "./icon-geometry.js";
import { isCompactIconViewBox } from "./use-is-mounted-icons.js";

const EXPLICIT_VIEWBOX_PATTERN = /viewBox\s*:\s*`([^`${}]+)`/;
const NATIVE_SHAPE_CALL_PATTERN =
	/(?:jsx|jsxs|createElement)\)\(`(?:path|circle|rect|line|polyline|polygon)`/;
const STATIC_PATH_DATA_PATTERN = /\bd\s*:\s*`[^`${}]+`/;

function hasExplicitNonIconViewBox(candidateSource: string): boolean {
	const match = candidateSource.match(EXPLICIT_VIEWBOX_PATTERN);
	const viewBox = match && match[1] ? match[1] : null;
	return viewBox !== null && !isCompactIconViewBox(viewBox);
}

function isSvgWrapperWithoutOwnedGeometry(candidateSource: string): boolean {
	return (
		!NATIVE_SHAPE_CALL_PATTERN.test(candidateSource) &&
		!STATIC_PATH_DATA_PATTERN.test(candidateSource)
	);
}

function isRuntimeGeneratedVisualization(candidateSource: string): boolean {
	return (
		candidateSource.includes("Array.from(") ||
		candidateSource.includes(".map(") ||
		/viewBox\s*:\s*`[^`]*\$\{/.test(candidateSource) ||
		hasConditionalPathGeometry(candidateSource)
	);
}

function hasConditionalPathGeometry(candidateSource: string): boolean {
	const ast = parse(candidateSource, {
		sourceType: "module",
		errorRecovery: false,
		plugins: ["jsx"],
	});
	let conditionalPath = false;
	traverse(ast, {
		ObjectProperty(path) {
			const key = path.node.key;
			const isPathData =
				(!path.node.computed && t.isIdentifier(key) && key.name === "d") ||
				t.isStringLiteral(key, { value: "d" });
			if (isPathData && t.isConditionalExpression(path.node.value)) {
				conditionalPath = true;
				path.stop();
			}
		},
	});
	return conditionalPath;
}
function stringValue(node: t.Node | null | undefined): string | null {
	if (t.isStringLiteral(node)) {
		return node.value;
	}
	if (
		t.isTemplateLiteral(node) &&
		node.expressions.length === 0 &&
		node.quasis.length === 1
	) {
		const quasi = node.quasis[0];
		return quasi ? quasi.value.cooked : null;
	}
	return null;
}

function calleeMember(
	node: t.Expression | t.V8IntrinsicIdentifier,
): t.MemberExpression | null {
	if (t.isMemberExpression(node)) {
		return node;
	}
	if (t.isSequenceExpression(node)) {
		const lastExpression = node.expressions[node.expressions.length - 1];
		return lastExpression && t.isMemberExpression(lastExpression)
			? lastExpression
			: null;
	}
	return null;
}

function isSvgConstruction(node: t.CallExpression): boolean {
	const member = calleeMember(node.callee);
	if (!member || !t.isIdentifier(member.property)) {
		return false;
	}
	const factoryName = member.property.name;
	if (
		factoryName !== "jsx" &&
		factoryName !== "jsxs" &&
		factoryName !== "createElement"
	) {
		return false;
	}
	const firstArgument = node.arguments[0];
	return !t.isSpreadElement(firstArgument) &&
		!t.isJSXNamespacedName(firstArgument)
		? stringValue(firstArgument) === "svg"
		: false;
}

function ownerName(path: NodePath<t.CallExpression>): string | null {
	const owner = path.findParent((candidate) =>
		candidate.isFunctionDeclaration(),
	);
	if (!owner || !owner.isFunctionDeclaration()) {
		return null;
	}
	return owner.node.id ? owner.node.id.name : null;
}

export function enumerateFeatureSvgCandidates(
	assetName: string,
	sourceText: string,
): readonly FeatureSvgCandidate[] {
	const ast = parse(sourceText, {
		sourceType: "module",
		errorRecovery: false,
		plugins: ["jsx"],
	});
	const candidates: FeatureSvgCandidate[] = [];

	traverse(ast, {
		CallExpression(path) {
			if (!isSvgConstruction(path.node)) {
				return;
			}
			const sourceStart = path.node.start;
			const sourceEnd = path.node.end;
			if (sourceStart === null || sourceEnd === null) {
				return;
			}
			const sourceFingerprint = createHash("sha256")
				.update(sourceText.slice(sourceStart, sourceEnd))
				.digest("hex");
			candidates.push({
				assetName,
				ownerName: ownerName(path),
				sourceStart,
				sourceEnd,
				sourceFingerprint,
				status: "candidate",
			});
		},
	});

	return candidates.sort((left, right) => left.sourceStart - right.sourceStart);
}

function extractedGeometryByCandidate(
	icons: readonly RawExtractedIcon[],
): ReadonlyMap<string, string> {
	const geometries = new Map<string, string>();
	for (const icon of icons) {
		if (!icon.originalName.startsWith("FeatureSvg")) {
			continue;
		}
		geometries.set(
			`${icon.sourceChunk}:${icon.originalName}`,
			geometryHash(icon),
		);
	}
	return geometries;
}

function dedicatedGeometriesByChunk(
	icons: readonly RawExtractedIcon[],
): ReadonlyMap<string, readonly string[]> {
	const geometries = new Map<string, string[]>();
	for (const icon of icons) {
		if (icon.sourceType !== "dedicated-chunk") {
			continue;
		}
		const chunkGeometries = geometries.get(icon.sourceChunk);
		if (chunkGeometries) {
			chunkGeometries.push(geometryHash(icon));
		} else {
			geometries.set(icon.sourceChunk, [geometryHash(icon)]);
		}
	}
	return geometries;
}

export function buildFeatureSvgCoverageReport(
	entries: readonly LinearCacheEntry[],
	extractedIcons: readonly RawExtractedIcon[],
): FeatureSvgCoverageReport {
	const corpusPayload = entries
		.map((entry) => ({
			assetName: entry.assetName,
			contentHash: createHash("sha256").update(entry.sourceText).digest("hex"),
		}))
		.sort((left, right) => left.assetName.localeCompare(right.assetName));
	const corpusHash = createHash("sha256")
		.update(JSON.stringify(corpusPayload))
		.digest("hex");
	const rows: FeatureSvgCoverageRow[] = [];
	const extractedGeometries = extractedGeometryByCandidate(extractedIcons);
	const dedicatedGeometries = dedicatedGeometriesByChunk(extractedIcons);
	let javascriptEntries = 0;

	for (const entry of entries) {
		if (!entry.assetName.endsWith(".js")) {
			continue;
		}
		javascriptEntries += 1;
		for (const [candidateIndex, candidate] of enumerateFeatureSvgCandidates(
			entry.assetName,
			entry.sourceText,
		).entries()) {
			const expectedName = `FeatureSvg${candidate.sourceFingerprint.slice(0, 12)}Icon`;
			const generatedGeometryHash = extractedGeometries.get(
				`${assetBaseName(entry.assetName)}:${expectedName}`,
			);
			const dedicatedGeometryHash = isDedicatedIconChunk(entry.assetName)
				? dedicatedGeometries.get(assetBaseName(entry.assetName))?.[candidateIndex]
				: undefined;
			const linkedGeometryHash = generatedGeometryHash
				? generatedGeometryHash
				: dedicatedGeometryHash;
			const candidateSource = entry.sourceText.slice(
				candidate.sourceStart,
				candidate.sourceEnd,
			);
			const runtimeGeneratedVisualization =
				isRuntimeGeneratedVisualization(candidateSource);
			const extracted =
				linkedGeometryHash !== undefined && !runtimeGeneratedVisualization;
			const excluded =
				!extracted && hasExplicitNonIconViewBox(candidateSource);
			const wrapperWithoutOwnedGeometry =
				!extracted &&
				!excluded &&
				isSvgWrapperWithoutOwnedGeometry(candidateSource);
			rows.push({
				candidateId: `${entry.assetName}:${candidate.sourceStart}:${candidate.sourceFingerprint}`,
				assetName: entry.assetName,
				ownerName: candidate.ownerName,
				sourceStart: candidate.sourceStart,
				sourceEnd: candidate.sourceEnd,
				sourceFingerprint: candidate.sourceFingerprint,
				geometryHash:
					extracted && linkedGeometryHash ? linkedGeometryHash : null,
				status: extracted
					? "extracted"
					: excluded
						? "excluded"
						: wrapperWithoutOwnedGeometry
							? "excluded"
							: runtimeGeneratedVisualization
								? "excluded"
						: "needs-review",
				reason: extracted
					? "recognized-extraction-path"
					: excluded
						? "explicit-non-icon-viewbox"
						: wrapperWithoutOwnedGeometry
							? "svg-wrapper-without-owned-geometry"
							: runtimeGeneratedVisualization
								? "runtime-generated-visualization"
						: "missing-semantic-evidence",
			});
		}
	}

	rows.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
	const extracted = rows.filter((row) => row.status === "extracted").length;
	const excluded = rows.filter((row) => row.status === "excluded").length;
	const needsReview = rows.length - extracted - excluded;
	const reportPayload = {
		schemaVersion: 2 as const,
		corpusHash,
		complete: needsReview === 0,
		stats: {
			decodedEntries: entries.length,
			javascriptEntries,
			candidates: rows.length,
			extracted,
			excluded,
			needsReview,
		},
		candidates: rows,
	};
	const reportHash = createHash("sha256")
		.update(JSON.stringify(reportPayload))
		.digest("hex");
	return {
		schemaVersion: 2,
		corpusHash,
		reportHash,
		complete: needsReview === 0,
		stats: reportPayload.stats,
		candidates: rows,
	};
}
