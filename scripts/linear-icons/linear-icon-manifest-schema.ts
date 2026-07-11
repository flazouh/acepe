import { z } from "zod";

const sourceSetSchema = z.union([
	z.literal("base"),
	z.literal("brands"),
	z.literal("decorative"),
	z.null(),
]);

const sourceTypeSchema = z.union([
	z.literal("dedicated-chunk"),
	z.literal("feature-jsx"),
	z.literal("symbol-sprite"),
	z.literal("shared-jsx"),
]);

const sourceOccurrenceSchema = z.object({
	originalName: z.string(),
	sourceChunk: z.string(),
	sourceType: sourceTypeSchema,
	sourceSet: sourceSetSchema,
});

const iconSchema = z.object({
	id: z.string(),
	originalName: z.string(),
	cleanName: z.string(),
	sourceChunk: z.string(),
	sourceType: sourceTypeSchema,
	sourceSet: sourceSetSchema,
	geometryHash: z.string().length(64),
	viewBox: z.string(),
	svgFile: z.string(),
	duplicateOf: z.string().nullable(),
	sourceOccurrences: z.array(sourceOccurrenceSchema),
});

export const linearIconInventoryManifestSchema = z.object({
	manifestVersion: z.literal(2),
	generatedAt: z.string(),
	cachePath: z.string(),
	inventoryHash: z.string().length(64),
	stats: z.object({
		cacheEntriesScanned: z.number().int().nonnegative(),
		assetChunksScanned: z.number().int().nonnegative(),
		iconsExtracted: z.number().int().nonnegative(),
		uniqueGeometry: z.number().int().nonnegative(),
		duplicates: z.number().int().nonnegative(),
	}),
	icons: z.array(iconSchema),
});
