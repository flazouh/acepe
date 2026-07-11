import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

import type {
	ExtractedSvgShape,
	LinearIconSourceSet,
	RawExtractedIcon,
} from "./types.js";
import { enumerateFeatureSvgCandidates } from "./feature-svg-candidates.js";
export { geometryHash, stableGeometryPayload } from "./icon-geometry.js";
import {
	assetBaseName,
	cleanIconName,
	isDedicatedIconChunk,
} from "./name-utils.js";
import {
	isCompactIconViewBox,
	knownBundleIconOriginalName,
	MAX_SHARED_BUNDLE_ICON_SCAN_DISTANCE,
	REGISTER_ACTION_BUNDLE_PATTERN,
	SHARED_BUNDLE_ICON_FN_PATTERN,
	USE_IS_MOUNTED_BUNDLE_PATTERN,
} from "./use-is-mounted-icons.js";

const SYMBOL_PATTERN =
	/<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
const SPRITE_ASSIGNMENT_PATTERN =
	/\b([A-Za-z_$][A-Za-z0-9_$]*)=`(<svg[\s\S]*?<\/svg>)`/g;
const SPRITE_RENDER_PATTERN =
	/\[[A-Za-z_$][A-Za-z0-9_$]*\]:`(Base|Brands|Decorative)`[\s\S]{0,240}?dangerouslySetInnerHTML:\{__html:([A-Za-z_$][A-Za-z0-9_$]*)\}/g;
const JSX_SHAPE_PATTERN =
	/(?:jsx|jsxs)\)\(`(path|circle|rect|line|polyline|polygon)`,\s*\{([^}]*)\}\)/g;
const CREATE_ELEMENT_SHAPE_PATTERN =
	/createElement\(`(path|circle|rect|line|polyline|polygon)`,\s*\{([^}]*)\}\)/g;
const ATTRIBUTE_PATTERN = /([A-Za-z][A-Za-z0-9]*)\s*:\s*`([^`]*)`/g;
const SVG_VIEWBOX_PATTERN = /viewBox:`([^`]+)`/;
const SVG_JSX_BLOCK_START = /(?:jsx|jsxs)\)\(`svg`,\s*\{/g;
const SVG_JSX_TOKEN = /(?:jsx|jsxs)\)\(`svg`/;
const ACTION_BOUND_ICON_PATTERN =
	/name\s*:([\s\S]{0,800}?)image\s*:\s*\(0,\s*[A-Za-z_$][\w$]*\.jsx\)\(([A-Za-z_$][\w$]*),\s*\{\}\)/g;
const DEFAULT_VIEW_BOX = "0 0 16 16";

function findMatchingBrace(
	source: string,
	openBraceIndex: number,
): number | null {
	if (source[openBraceIndex] !== "{") {
		return null;
	}

	let depth = 0;
	let inString = false;
	let stringDelimiter = "";

	for (let index = openBraceIndex; index < source.length; index += 1) {
		const character = source[index];
		const previousCharacter = index > 0 ? source[index - 1] : "";

		if (inString) {
			if (character === stringDelimiter && previousCharacter !== "\\") {
				inString = false;
			}
			continue;
		}

		if (character === "`" || character === "'" || character === '"') {
			inString = true;
			stringDelimiter = character;
			continue;
		}

		if (character === "{") {
			depth += 1;
			continue;
		}

		if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	return null;
}

function extractSvgJsxBlockSources(sourceText: string): string[] {
	const blocks: string[] = [];

	for (const match of sourceText.matchAll(SVG_JSX_BLOCK_START)) {
		const matchIndex = match.index;
		if (matchIndex === undefined) {
			continue;
		}

		const openBraceIndex = matchIndex + match[0].length - 1;
		const closeBraceIndex = findMatchingBrace(sourceText, openBraceIndex);
		if (closeBraceIndex === null) {
			continue;
		}

		blocks.push(sourceText.slice(matchIndex, closeBraceIndex + 1));
	}

	return blocks;
}

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
	return attributeName.replace(
		/[A-Z]/g,
		(letter) => `-${letter.toLowerCase()}`,
	);
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

	if (
		tag === "circle" &&
		(!normalizedAttributes.cx ||
			!normalizedAttributes.cy ||
			!normalizedAttributes.r)
	) {
		return null;
	}

	if (
		tag === "rect" &&
		(!normalizedAttributes.width ||
			!normalizedAttributes.height)
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
		const attributeSource = match[2] ? match[2] : "";
		const attributes: Record<string, string> = {};
		const htmlAttributePattern = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;
		for (const attributeMatch of attributeSource.matchAll(
			htmlAttributePattern,
		)) {
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

function normalizeSourceSet(label: string): LinearIconSourceSet {
	switch (label) {
		case "Base":
			return "base";
		case "Brands":
			return "brands";
		case "Decorative":
			return "decorative";
		default:
			return null;
	}
}

function spriteSetBindings(
	sourceText: string,
): ReadonlyMap<string, LinearIconSourceSet> {
	const bindings = new Map<string, LinearIconSourceSet>();
	for (const match of sourceText.matchAll(SPRITE_RENDER_PATTERN)) {
		const label = match[1];
		const variableName = match[2];
		if (label && variableName) {
			bindings.set(variableName, normalizeSourceSet(label));
		}
	}
	return bindings;
}

function extractSymbolsFromMarkup(
	sourceChunk: string,
	markup: string,
	sourceSet: LinearIconSourceSet,
): RawExtractedIcon[] {
	const icons: RawExtractedIcon[] = [];

	for (const match of markup.matchAll(SYMBOL_PATTERN)) {
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
			sourceSet,
			viewBox,
			shapes,
		});
	}

	return icons;
}

function extractSymbolIcons(
	sourceChunk: string,
	sourceText: string,
): RawExtractedIcon[] {
	const bindings = spriteSetBindings(sourceText);
	const icons: RawExtractedIcon[] = [];
	let foundAssignedSprite = false;

	for (const match of sourceText.matchAll(SPRITE_ASSIGNMENT_PATTERN)) {
		const variableName = match[1];
		const markup = match[2];
		if (!variableName || !markup || !bindings.has(variableName)) {
			continue;
		}
		foundAssignedSprite = true;
		const boundSourceSet = bindings.get(variableName);
		const sourceSet = boundSourceSet === undefined ? null : boundSourceSet;
		for (const icon of extractSymbolsFromMarkup(
			sourceChunk,
			markup,
			sourceSet,
		)) {
			icons.push(icon);
		}
	}

	return foundAssignedSprite
		? icons
		: extractSymbolsFromMarkup(sourceChunk, sourceText, null);
}

function extractJsxShapes(
	sourceText: string,
	fullSourceText: string,
): ExtractedSvgShape[] {
	const astShapes = extractStaticShapesFromAst(sourceText, fullSourceText);
	if (astShapes.length > 0) {
		return astShapes;
	}

	const shapes: ExtractedSvgShape[] = [];
	for (const match of sourceText.matchAll(JSX_SHAPE_PATTERN)) {
		const tag = match[1] as ExtractedSvgShape["tag"];
		const attributeSource = match[2];
		if (!attributeSource) {
			continue;
		}
		const attributes = parseJsxAttributes(attributeSource);
		const shape = shapeFromAttributes(tag, attributes);
		if (shape) {
			shapes.push(shape);
		}
	}
	for (const match of sourceText.matchAll(CREATE_ELEMENT_SHAPE_PATTERN)) {
		const tag = match[1] as ExtractedSvgShape["tag"];
		const attributeSource = match[2];
		if (!attributeSource) {
			continue;
		}
		const shape = shapeFromAttributes(tag, parseJsxAttributes(attributeSource));
		if (shape) {
			shapes.push(shape);
		}
	}

	return shapes;
}

function staticAttributeValue(
	node: t.Node | null | undefined,
	fullSourceText: string,
): string | null {
	if (t.isStringLiteral(node)) {
		return node.value;
	}
	if (t.isNumericLiteral(node)) {
		return String(node.value);
	}
	if (
		t.isTemplateLiteral(node) &&
		node.expressions.length === 0 &&
		node.quasis.length === 1
	) {
		return node.quasis[0]?.value.cooked ?? null;
	}
	if (t.isIdentifier(node)) {
		const literalBindingPattern = new RegExp(
			`\\b${node.name}\\s*=\\s*\`([^\`]*)\``,
		);
		return fullSourceText.match(literalBindingPattern)?.[1] ?? null;
	}
	return null;
}

function staticShapeTag(
	node: t.Node | null | undefined,
	fullSourceText: string,
): ExtractedSvgShape["tag"] | null {
	const value = staticAttributeValue(node, fullSourceText);
	if (
		value === "path" ||
		value === "circle" ||
		value === "rect" ||
		value === "line" ||
		value === "polyline" ||
		value === "polygon"
	) {
		return value;
	}
	if (t.isIdentifier(node)) {
		const wrapperSource = componentFunctionBlock(fullSourceText, node.name);
		const wrapperShape = wrapperSource?.match(
			/(?:jsx|jsxs|createElement)\)\(`(path|circle|rect|line|polyline|polygon)`/,
		)?.[1];
		if (
			wrapperShape === "path" ||
			wrapperShape === "circle" ||
			wrapperShape === "rect" ||
			wrapperShape === "line" ||
			wrapperShape === "polyline" ||
			wrapperShape === "polygon"
		) {
			return wrapperShape;
		}
	}
	return null;
}

function extractStaticShapesFromAst(
	sourceText: string,
	fullSourceText: string,
): ExtractedSvgShape[] {
	let ast: ReturnType<typeof parse>;
	try {
		ast = parse(sourceText, {
			sourceType: "module",
			errorRecovery: false,
			plugins: ["jsx"],
		});
	} catch {
		return [];
	}

	const shapes: ExtractedSvgShape[] = [];
	traverse(ast, {
		CallExpression(path) {
			const firstArgument = path.node.arguments[0];
			if (!firstArgument || t.isSpreadElement(firstArgument)) {
				return;
			}
			const tag = staticShapeTag(firstArgument, fullSourceText);
			const props = path.node.arguments[1];
			if (!tag || !props || !t.isObjectExpression(props)) {
				return;
			}

			const attributes: Record<string, string> = {};
			for (const property of props.properties) {
				if (!t.isObjectProperty(property) || property.computed) {
					continue;
				}
				const attributeName = t.isIdentifier(property.key)
					? property.key.name
					: t.isStringLiteral(property.key)
						? property.key.value
						: null;
				const attributeValue = staticAttributeValue(
					property.value,
					fullSourceText,
				);
				if (attributeName && attributeValue !== null) {
					attributes[attributeName] = attributeValue;
				}
			}

			const shape = shapeFromAttributes(tag, attributes);
			if (shape) {
				shapes.push(shape);
			}
		},
	});
	return shapes;
}

function extractJsxIconFromBlock(
	originalName: string,
	sourceChunk: string,
	sourceType: RawExtractedIcon["sourceType"],
	blockSource: string,
	fullSourceText: string,
): RawExtractedIcon | null {
	const shapes = extractJsxShapes(blockSource, fullSourceText);
	if (shapes.length === 0) {
		return null;
	}

	const viewBoxMatch = blockSource.match(SVG_VIEWBOX_PATTERN);
	const viewBox =
		viewBoxMatch && viewBoxMatch[1] ? viewBoxMatch[1] : DEFAULT_VIEW_BOX;

	return {
		originalName,
		sourceChunk,
		sourceType,
		sourceSet: null,
		viewBox,
		shapes,
	};
}

function extractJsxIcons(
	originalName: string,
	sourceChunk: string,
	sourceType: RawExtractedIcon["sourceType"],
	sourceText: string,
): RawExtractedIcon[] {
	const svgBlocks = extractSvgJsxBlockSources(sourceText);
	if (svgBlocks.length === 0) {
		const fallbackIcon = extractJsxIconFromBlock(
			originalName,
			sourceChunk,
			sourceType,
			sourceText,
			sourceText,
		);
		return fallbackIcon ? [fallbackIcon] : [];
	}

	const icons: RawExtractedIcon[] = [];
	for (const [blockIndex, blockSource] of svgBlocks.entries()) {
		const blockOriginalName =
			blockIndex === 0
				? originalName
				: `${originalName.replace(/Icon$/, "")}Variant${blockIndex + 1}`;
		const icon = extractJsxIconFromBlock(
			blockOriginalName,
			sourceChunk,
			sourceType,
			blockSource,
			sourceText,
		);
		if (icon) {
			icons.push(icon);
		}
	}

	return icons;
}

function extractSharedBundleIconsFromCacheEntry(
	assetName: string,
	sourceText: string,
): RawExtractedIcon[] {
	if (
		!USE_IS_MOUNTED_BUNDLE_PATTERN.test(assetName) &&
		!REGISTER_ACTION_BUNDLE_PATTERN.test(assetName)
	) {
		return [];
	}

	const sourceChunk = assetBaseName(assetName);
	const icons: RawExtractedIcon[] = [];

	for (const match of sourceText.matchAll(SHARED_BUNDLE_ICON_FN_PATTERN)) {
		const fnName = match[1];
		const matchIndex = match.index;
		if (!fnName || matchIndex === undefined) {
			continue;
		}
		const originalName = knownBundleIconOriginalName(assetName, fnName);
		if (!originalName) {
			continue;
		}

		const scanEnd = Math.min(
			sourceText.length,
			matchIndex + MAX_SHARED_BUNDLE_ICON_SCAN_DISTANCE,
		);
		const scanWindow = sourceText.slice(matchIndex, scanEnd);
		const svgTokenIndex = scanWindow.search(SVG_JSX_TOKEN);
		if (svgTokenIndex === -1) {
			continue;
		}

		const svgStart = matchIndex + svgTokenIndex;

		const openBraceIndex = sourceText.indexOf("{", svgStart);
		if (openBraceIndex === -1) {
			continue;
		}

		const closeBraceIndex = findMatchingBrace(sourceText, openBraceIndex);
		if (closeBraceIndex === null) {
			continue;
		}

		const blockSource = sourceText.slice(svgStart, closeBraceIndex + 1);
		const icon = extractJsxIconFromBlock(
			originalName,
			sourceChunk,
			"shared-jsx",
			blockSource,
			sourceText,
		);
		if (!icon || !isCompactIconViewBox(icon.viewBox)) {
			continue;
		}

		icons.push(icon);
	}

	return icons;
}

function semanticIconName(actionSource: string): string | null {
	const labels: string[] = [];
	for (const match of actionSource.matchAll(/`([^`]+)`/g)) {
		const label = match[1];
		if (!label || label.includes("${")) {
			continue;
		}
		labels.push(label);
	}

	labels.sort((left, right) => {
		const lengthOrder = left.length - right.length;
		return lengthOrder === 0 ? left.localeCompare(right) : lengthOrder;
	});
	const label = labels[0];
	if (!label || label.trim().length < 3) {
		return null;
	}

	const words = label.match(/[A-Za-z0-9]+/g);
	if (!words || words.length === 0) {
		return null;
	}
	const pascalName = words
		.map(
			(word) =>
				`${word[0] ? word[0].toUpperCase() : ""}${word.slice(1).toLowerCase()}`,
		)
		.join("");
	if (pascalName.length < 3) {
		return null;
	}
	return `${pascalName}Icon`;
}

function componentFunctionBlock(
	sourceText: string,
	componentName: string,
): string | null {
	const functionStart = sourceText.indexOf(`function ${componentName}(`);
	if (functionStart === -1) {
		return null;
	}
	const openBraceIndex = sourceText.indexOf("{", functionStart);
	if (openBraceIndex === -1) {
		return null;
	}
	const closeBraceIndex = findMatchingBrace(sourceText, openBraceIndex);
	return closeBraceIndex === null
		? null
		: sourceText.slice(functionStart, closeBraceIndex + 1);
}

function extractActionBoundIcons(
	assetName: string,
	sourceText: string,
): RawExtractedIcon[] {
	const icons: RawExtractedIcon[] = [];
	const sourceChunk = assetBaseName(assetName);
	for (const match of sourceText.matchAll(ACTION_BOUND_ICON_PATTERN)) {
		const actionSource = match[1];
		const componentName = match[2];
		if (!actionSource || !componentName) {
			continue;
		}
		const originalName = semanticIconName(actionSource);
		const blockSource = componentFunctionBlock(sourceText, componentName);
		if (!originalName || !blockSource) {
			continue;
		}
		const icon = extractJsxIconFromBlock(
			originalName,
			sourceChunk,
			"feature-jsx",
			blockSource,
			sourceText,
		);
		if (icon && isCompactIconViewBox(icon.viewBox)) {
			icons.push(icon);
		}
	}
	return icons;
}

function extractFeatureBundleCandidateIcons(
	assetName: string,
	sourceText: string,
): RawExtractedIcon[] {
	if (isDedicatedIconChunk(assetName)) {
		return [];
	}
	const icons: RawExtractedIcon[] = [];
	const sourceChunk = assetBaseName(assetName);
	for (const candidate of enumerateFeatureSvgCandidates(
		assetName,
		sourceText,
	)) {
		const blockSource = sourceText.slice(
			candidate.sourceStart,
			candidate.sourceEnd,
		);
		const icon = extractJsxIconFromBlock(
			`FeatureSvg${candidate.sourceFingerprint.slice(0, 12)}Icon`,
			sourceChunk,
			"feature-jsx",
			blockSource,
			sourceText,
		);
		if (icon && isCompactIconViewBox(icon.viewBox)) {
			icons.push(icon);
		}
	}
	return icons;
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
		const dedicatedIcons = extractJsxIcons(
			sourceChunk,
			sourceChunk,
			"dedicated-chunk",
			sourceText,
		);
		for (const dedicatedIcon of dedicatedIcons) {
			icons.push(dedicatedIcon);
		}
	}

	for (const sharedBundleIcon of extractSharedBundleIconsFromCacheEntry(
		assetName,
		sourceText,
	)) {
		icons.push(sharedBundleIcon);
	}

	for (const actionBoundIcon of extractActionBoundIcons(
		assetName,
		sourceText,
	)) {
		icons.push(actionBoundIcon);
	}

	for (const featureIcon of extractFeatureBundleCandidateIcons(
		assetName,
		sourceText,
	)) {
		icons.push(featureIcon);
	}

	return icons;
}

export function provisionalCleanName(icon: RawExtractedIcon): string {
	return cleanIconName(icon.originalName);
}
