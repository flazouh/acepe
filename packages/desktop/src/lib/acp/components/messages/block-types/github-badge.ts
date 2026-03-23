import { Result } from "neverthrow";
import { z } from "zod";
import { createLogger } from "../../../utils/logger.js";
import type { BlockParseConfig } from "./types.js";

const logger = createLogger({ id: "github-badge-block", name: "GitHub Badge Block" });

/** Exported for use by mount-github-badges (inline placeholder validation). */
export const gitHubReferenceSchema = z.union([
	z.object({
		type: z.literal("pr"),
		owner: z.string(),
		repo: z.string(),
		number: z.number(),
	}),
	z.object({
		type: z.literal("commit"),
		sha: z.string(),
		owner: z.string().optional(),
		repo: z.string().optional(),
	}),
	z.object({
		type: z.literal("issue"),
		owner: z.string(),
		repo: z.string(),
		number: z.number(),
	}),
]);

export const githubBadgeBlockConfig: BlockParseConfig<"github_badge"> = {
	type: "github_badge",
	regex: /<div class="github-badge-placeholder" data-github-ref="([^"]+)"><\/div>/g,
	parse: (match) => {
		const refJson = decodeURIComponent(match[1]).replace(/&quot;/g, '"');
		const parseResult = Result.fromThrowable(
			() => JSON.parse(refJson),
			(error) => error
		)();

		return parseResult.match(
			(parsedData) => {
				const validationResult = gitHubReferenceSchema.safeParse(parsedData);
				if (!validationResult.success) {
					logger.error("Failed to validate GitHub badge placeholder", {
						error: validationResult.error.message,
						json: match[1],
					});
					return null;
				}
				return {
					type: "github_badge" as const,
					ref: validationResult.data,
				};
			},
			(error) => {
				logger.error("Failed to parse GitHub badge placeholder", { error, json: match[1] });
				return null;
			}
		);
	},
};
