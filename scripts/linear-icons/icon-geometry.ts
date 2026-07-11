import { createHash } from "node:crypto";

import type { RawExtractedIcon } from "./types/raw-extracted-icon.js";

export function stableGeometryPayload(icon: RawExtractedIcon): string {
	const shapePayload = icon.shapes
		.map((shape) => {
			const attributeEntries = Object.entries(shape.attributes)
				.sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
				.map(
					([attributeName, attributeValue]) =>
						`${attributeName}=${attributeValue}`,
				);
			return `${shape.tag}|${attributeEntries.join("|")}`;
		})
		.join("||");

	return `${icon.viewBox}::${shapePayload}`;
}

export function geometryHash(icon: RawExtractedIcon): string {
	return createHash("sha256").update(stableGeometryPayload(icon)).digest("hex");
}
