import { z } from "zod";

export const linearIconCoverageSummarySchema = z.object({
	complete: z.boolean(),
	corpusHash: z.string().length(64),
	reportHash: z.string().length(64),
	stats: z.object({
		decodedEntries: z.number().int().nonnegative(),
		javascriptEntries: z.number().int().nonnegative(),
		candidates: z.number().int().nonnegative(),
		extracted: z.number().int().nonnegative(),
		excluded: z.number().int().nonnegative(),
		needsReview: z.number().int().nonnegative(),
	}),
});
