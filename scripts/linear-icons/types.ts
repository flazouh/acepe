export type LinearIconSourceType =
	| "dedicated-chunk"
	| "symbol-sprite"
	| "shared-jsx";

export type LinearCacheEntry = {
	readonly cacheFile: string;
	readonly urlKey: string;
	readonly assetName: string;
	readonly contentEncoding: string;
	readonly sourceText: string;
};

export type ExtractedSvgShape = {
	readonly tag: "path" | "circle" | "rect" | "line" | "polyline" | "polygon";
	readonly attributes: Readonly<Record<string, string>>;
};

export type RawExtractedIcon = {
	readonly originalName: string;
	readonly sourceChunk: string;
	readonly sourceType: LinearIconSourceType;
	readonly viewBox: string;
	readonly shapes: readonly ExtractedSvgShape[];
};

export type NormalizedLinearIcon = {
	readonly originalName: string;
	readonly cleanName: string;
	readonly sourceChunk: string;
	readonly sourceType: LinearIconSourceType;
	readonly viewBox: string;
	readonly geometryHash: string;
	readonly svg: string;
	readonly duplicateOf: string | null;
};

export type LinearIconInventoryManifest = {
	readonly manifestVersion: 1;
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
		readonly geometryHash: string;
		readonly viewBox: string;
		readonly svgFile: string;
		readonly duplicateOf: string | null;
	}[];
};
