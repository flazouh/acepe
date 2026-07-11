import type { LinearIconSourceOccurrence } from "./linear-icon-source-occurrence.js";
import type { LinearIconSourceSet } from "./linear-icon-source-set.js";
import type { LinearIconSourceType } from "./linear-icon-source-type.js";

export type LinearIconInventoryManifest = {
	readonly manifestVersion: 2;
	readonly generatedAt: string;
	readonly cachePath: string;
	readonly inventoryHash: string;
	readonly stats: {
		readonly cacheEntriesScanned: number;
		readonly assetChunksScanned: number;
		readonly iconsExtracted: number;
		readonly uniqueGeometry: number;
		readonly duplicates: number;
	};
	readonly icons: readonly {
		readonly id: string;
		readonly originalName: string;
		readonly cleanName: string;
		readonly sourceChunk: string;
		readonly sourceType: LinearIconSourceType;
		readonly sourceSet: LinearIconSourceSet;
		readonly geometryHash: string;
		readonly viewBox: string;
		readonly svgFile: string;
		readonly duplicateOf: string | null;
		readonly sourceOccurrences: readonly LinearIconSourceOccurrence[];
	}[];
};
