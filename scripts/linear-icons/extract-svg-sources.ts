import { createHash } from "node:crypto";

import type { ExtractedSvgShape, RawExtractedIcon } from "./types.js";
import { assetBaseName, cleanIconName, isDedicatedIconChunk } from "./name-utils.js";

const SYMBOL_PATTERN =
	/<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
const JSX_PATH_PATTERN =
	/(?:jsx|jsxs)\)\(`(?:path|circle|rect|line|polyline|polygon)`,\{([^}]*)\}\)/g;
const ATTRIBUTE_PATTERN = /([A-Za-z][A-Za-z0-9]*):`([^`]*)`/g;
const SVG_VIEWBOX_PATTERN = /viewBox:`([^`]+)`/;
const DEFAULT_VIEW_BOX = "0 0 16 16";

function parseJsxAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
		const attributeName = match[1];
		const attributeValue = match[2];
		if (!attributeName || attributeValue === undefined) {
			continue;
		}
		attributes[attributeName] = attributeValue;
	}
	return attributes;
}

function kebabAttributeName(attributeName: string): string {
	return attributeName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function shapeFromAttributes(
	tag: ExtractedSvgShape["tag"],
	attributes: Record<string, string>,
): ExtractedSvgShape | null {
	const normalizedAttributes: Record<string, string> = {};
	for (const [attributeName, attributeValue] of Object.entries(attributes)) {
		normalizedAttributes[kebabAttributeName(attributeName)] = attributeValue;
	}

	if (tag === "path" && !normalizedAttributes.d) {
		return null;
	}

	if (tag === "circle" && (!normalizedAttributes.cx || !normalizedAttributes.cy || !normalizedAttributes.r)) {
		return null;
	}

	if (
		tag === "rect" &&
		(!normalizedAttributes.x || !normalizedAttributes.y || !normalizedAttributes.width || !normalizedAttributes.height)
	) {
		return null;
	}

	return {
		tag,
		attributes: normalizedAttributes,
	};
}

function parseShapeMarkup(markup: string): ExtractedSvgShape[] {
	const shapes: ExtractedSvgShape[] = [];
	const shapePattern =
		/<(path|circle|rect|line|polyline|polygon)\b([^>]*)\/?>/g;

	for (const match of markup.matchAll(shapePattern)) {
		const tag = match[1] as ExtractedSvgShape["tag"];
		const attributeSource = match[2] ?? "";
		const attributes: Record<string, string> = {};
		const htmlAttributePattern = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;
		for (const attributeMatch of attributeSource.matchAll(htmlAttributePattern)) {
			const attributeName = attributeMatch[1];
			const attributeValue = attributeMatch[2];
			if (!attributeName || attributeValue === undefined) {
				continue;
			}
			attributes[attributeName] = attributeValue;
		}

		const shape = shapeFromAttributes(tag, attributes);
		if (shape) {
			shapes.push(shape);
		}
	}

	return shapes;
}

function extractSymbolIcons(sourceChunk: string, sourceText: string): RawExtractedIcon[] {
	const icons: RawExtractedIcon[] = [];

	for (const match of sourceText.matchAll(SYMBOL_PATTERN)) {
		const originalName = match[1];
		const viewBox = match[2];
		const innerMarkup = match[3];
		if (!originalName || !viewBox || !innerMarkup) {
			continue;
		}

		const shapes = parseShapeMarkup(innerMarkup);
		if (shapes.length === 0) {
			continue;
		}

		icons.push({
			originalName,
			sourceChunk,
			sourceType: "symbol-sprite",
			viewBox,
			shapes,
		});
	}

	return icons;
}

function extractJsxIcons(
	originalName: string,
	sourceChunk: string,
	sourceType: RawExtractedIcon["sourceType"],
	sourceText: string,
): RawExtractedIcon | null {
	const shapes: ExtractedSvgShape[] = [];
	for (const match of sourceText.matchAll(JSX_PATH_PATTERN)) {
		const attributeSource = match[1];
		if (!attributeSource) {
			continue;
		}
		const attributes = parseJsxAttributes(attributeSource);
		const shape = shapeFromAttributes("path", attributes);
		if (shape) {
			shapes.push(shape);
		}
	}

	if (shapes.length === 0) {
		return null;
	}

	const viewBoxMatch = sourceText.match(SVG_VIEWBOX_PATTERN);
	const viewBox = viewBoxMatch?.[1] ?? DEFAULT_VIEW_BOX;

	return {
		originalName,
		sourceChunk,
		sourceType,
		viewBox,
		shapes,
	};
}

export function extractIconsFromCacheEntry(
	assetName: string,
	sourceText: string,
): RawExtractedIcon[] {
	const sourceChunk = assetBaseName(assetName);
	const icons: RawExtractedIcon[] = extractSymbolIcons(sourceChunk, sourceText);

	if (!assetName.endsWith(".js")) {
		return icons;
	}

	if (isDedicatedIconChunk(assetName)) {
		const dedicatedIcon = extractJsxIcons(
			sourceChunk,
			sourceChunk,
			"dedicated-chunk",
			sourceText,
		);
		if (dedicatedIcon) {
			icons.push(dedicatedIcon);
		}
		return icons;
	}

	if (sourceText.includes("jsx") && sourceText.includes("svg") && sourceText.includes("path")) {
		const sharedIcon = extractJsxIcons(
			sourceChunk,
			sourceChunk,
			"shared-jsx",
			sourceText,
		);
		if (sharedIcon) {
			icons.push(sharedIcon);
		}
	}

	return icons;
}

export function stableGeometryPayload(icon: RawExtractedIcon): string {
	const shapePayload = icon.shapes
		.map((shape) => {
			const attributeEntries = Object.entries(shape.attributes)
				.sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
				.map(([attributeName, attributeValue]) => `${attributeName}=${attributeValue}`);
			return `${shape.tag}|${attributeEntries.join("|")}`;
		})
		.join("||");

	return `${icon.viewBox}::${shapePayload}`;
}

export function geometryHash(icon: RawExtractedIcon): string {
	return createHash("sha256").update(stableGeometryPayload(icon)).digest("hex");
}

export function provisionalCleanName(icon: RawExtractedIcon): string {
	return cleanIconName(icon.originalName);
}
