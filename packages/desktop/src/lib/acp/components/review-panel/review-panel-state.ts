import type { ReviewWorkspaceFileItem } from "@acepe/ui";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";

export function buildReviewWorkspaceFileItems(
	files: readonly ModifiedFileEntry[],
	reviewedKeys: ReadonlySet<string>
): ReviewWorkspaceFileItem[] {
	return files.map((file) => {
		const fileKey = createReviewFileRevisionKey(file);

		return {
			id: file.filePath,
			filePath: file.filePath,
			fileName: file.fileName,
			reviewStatus: reviewedKeys.has(fileKey) ? "reviewed" : "unreviewed",
			additions: file.totalAdded,
			deletions: file.totalRemoved,
		};
	});
}
