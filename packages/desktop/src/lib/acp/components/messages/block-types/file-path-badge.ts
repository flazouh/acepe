import { Result } from "neverthrow";
import { z } from "zod";
import { createLogger } from "../../../utils/logger.js";
import type { BlockParseConfig } from "./types.js";

const logger = createLogger({ id: "file-path-badge-block", name: "File Path Badge Block" });

const filePathReferenceSchema = z.object({
	filePath: z.string(),
	locationSuffix: z.string(),
});

export const filePathBadgeBlockConfig: BlockParseConfig<"file_path_badge"> = {
	type: "file_path_badge",
	regex: /<div class="file-path-badge-placeholder" data-file-ref="([^"]+)"><\/div>/g,
	parse: (match) => {
		const refJson = decodeURIComponent(match[1]);
		const parseResult = Result.fromThrowable(
			() => JSON.parse(refJson),
			(error) => error
		)();

		return parseResult.match(
			(parsedData) => {
				const validationResult = filePathReferenceSchema.safeParse(parsedData);
				if (!validationResult.success) {
					logger.error("Failed to validate file path badge placeholder", {
						error: validationResult.error.message,
						json: match[1],
					});
					return null;
				}
				return {
					type: "file_path_badge" as const,
					filePath: validationResult.data.filePath,
					locationSuffix: validationResult.data.locationSuffix,
				};
			},
			(error) => {
				logger.error("Failed to parse file path badge placeholder", { error, json: match[1] });
				return null;
			}
		);
	},
};
