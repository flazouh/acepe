import type { LinearIconInventoryManifest } from "./linear-icon-inventory-manifest.js";

export type LinearIconCatalogEntry = {
	readonly name: string;
	readonly label: string;
	readonly sourceChunk: string;
	readonly sourceType: string;
	readonly sourceSet: string | null;
	readonly sourceOccurrences: LinearIconInventoryManifest["icons"][number]["sourceOccurrences"];
	readonly geometryHash: string;
	readonly viewBox: string;
	readonly inner: string;
};
