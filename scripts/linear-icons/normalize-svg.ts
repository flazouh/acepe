import type { ExtractedSvgShape, RawExtractedIcon } from "./types.js";

const PATH_TOKEN_PATTERN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
const NON_PATH_NUMBER_PATTERN = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const STROKE_ATTRIBUTE_NAMES = [
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"stroke-dashoffset",
] as const;

function normalizeNumber(value: string): string {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return value;
	}
	return parsed.toFixed(4).replace(/\.?0+$/, "");
}

export function normalizePathData(pathData: string): string {
	const tokens = pathData.match(PATH_TOKEN_PATTERN) ?? [];
	const normalizedTokens: string[] = [];

	for (const token of tokens) {
		if (/^[a-zA-Z]$/.test(token)) {
			normalizedTokens.push(token);
			continue;
		}

		const parsed = Number(token);
		if (!Number.isFinite(parsed)) {
			normalizedTokens.push(token);
			continue;
		}

		normalizedTokens.push(normalizeNumber(String(parsed)));
	}

	return normalizedTokens.join(" ");
}

function normalizeAttributeValue(attributeName: string, attributeValue: string): string {
	if (attributeName === "d") {
		return normalizePathData(attributeValue);
	}

	if (
		attributeName === "fill" ||
		attributeName === "stroke" ||
		attributeName === "color"
	) {
		return "currentColor";
	}

	if (NON_PATH_NUMBER_PATTERN.test(attributeValue)) {
		return attributeValue.replace(NON_PATH_NUMBER_PATTERN, (match) => normalizeNumber(match));
	}

	return attributeValue;
}

function shapeUsesStroke(shape: ExtractedSvgShape): boolean {
	for (const attributeName of STROKE_ATTRIBUTE_NAMES) {
		const attributeValue = shape.attributes[attributeName];
		if (attributeValue && attributeValue !== "none") {
			return true;
		}
	}

	return Boolean(shape.attributes.stroke && shape.attributes.stroke !== "none");
}

function renderShape(shape: ExtractedSvgShape): string {
	const attributes: string[] = [];
	for (const [attributeName, attributeValue] of Object.entries(shape.attributes)) {
		if (attributeName === "fill" || attributeName === "stroke") {
			continue;
		}
		attributes.push(
			`${attributeName}="${normalizeAttributeValue(attributeName, attributeValue)}"`,
		);
	}

	const usesStroke = shapeUsesStroke(shape);
	if (usesStroke) {
		attributes.push(`stroke="currentColor"`);
		if (!shape.attributes["stroke-width"]) {
			attributes.push(`stroke-width="1.5"`);
		}
		attributes.push(`fill="none"`);
	} else {
		attributes.push(`fill="currentColor"`);
	}

	return `<${shape.tag} ${attributes.join(" ")}></${shape.tag}>`;
}

export function normalizeLinearSvg(icon: RawExtractedIcon): string {
	const inner = icon.shapes.map((shape) => renderShape(shape)).join("");
	return `<svg viewBox="${icon.viewBox}" xmlns="http://www.w3.org/2000/svg"><g fill="none">${inner}</g></svg>`;
}

export function normalizeViewBox(viewBox: string): string {
	const parts = viewBox.trim().split(/\s+/).map((part) => normalizeNumber(part));
	if (parts.length !== 4) {
		return viewBox;
	}
	return parts.join(" ");
}

export function normalizeRawIcon(icon: RawExtractedIcon): RawExtractedIcon {
	return {
		originalName: icon.originalName,
		sourceChunk: icon.sourceChunk,
		sourceType: icon.sourceType,
		viewBox: normalizeViewBox(icon.viewBox),
		shapes: icon.shapes.map((shape) => {
			const attributes: Record<string, string> = {};
			for (const [attributeName, attributeValue] of Object.entries(shape.attributes)) {
				attributes[attributeName] = normalizeAttributeValue(attributeName, attributeValue);
			}
			return {
				tag: shape.tag,
				attributes,
			};
		}),
	};
}
