import type { ExtractedSvgShape, RawExtractedIcon } from "./types.js";

const NUMBER_PATTERN = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

function normalizeNumber(value: string): string {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return value;
	}
	return parsed.toFixed(4).replace(/\.?0+$/, "");
}

function normalizePathData(pathData: string): string {
	return pathData.replace(NUMBER_PATTERN, (match) => normalizeNumber(match));
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

	if (NUMBER_PATTERN.test(attributeValue)) {
		return attributeValue.replace(NUMBER_PATTERN, (match) => normalizeNumber(match));
	}

	return attributeValue;
}

function shapeUsesStroke(shape: ExtractedSvgShape): boolean {
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
