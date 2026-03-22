import { FilePathBadge } from "@acepe/ui";
import { Result } from "neverthrow";
import { mount, unmount } from "svelte";
import { z } from "zod";

import type { DiffStats } from "./file-chip-diff-enhancer.js";

const filePathRefSchema = z.object({ filePath: z.string(), locationSuffix: z.string() });

/**
 * Finds file-path-badge placeholder <span>s inside a container and mounts
 * FilePathBadge Svelte components into them. Returns a cleanup function that
 * unmounts all mounted components.
 *
 * Placeholders are inline <span>s that stay inside their parent elements
 * (li, p, etc.) so the HTML structure is never broken by block splitting.
 */
export function mountFileBadges(
	container: HTMLElement,
	resolveDiffStats: (filePath: string) => DiffStats | null
): () => void {
	const mounted: ReturnType<typeof mount>[] = [];

	const placeholders = container.querySelectorAll(".file-path-badge-placeholder");
	for (const el of placeholders) {
		// Skip if already mounted (re-entrant guard)
		if (el.children.length > 0) continue;

		const encoded = el.getAttribute("data-file-ref");
		if (!encoded) continue;

		const parseResult = Result.fromThrowable(
			() => JSON.parse(decodeURIComponent(encoded)) as unknown,
			(error) => error
		)();

		parseResult.map((parsed) => {
			const validation = filePathRefSchema.safeParse(parsed);
			if (!validation.success) return;

			const { filePath, locationSuffix } = validation.data;
			const displayName = filePath.split("/").pop() ?? filePath;
			const stats = resolveDiffStats(filePath);

			const component = mount(FilePathBadge, {
				target: el as HTMLElement,
				props: {
					filePath,
					fileName: locationSuffix ? `${displayName}${locationSuffix}` : undefined,
					iconBasePath: "/svgs/icons",
					linesAdded: stats?.insertions ?? 0,
					linesRemoved: stats?.deletions ?? 0,
					interactive: false,
				},
			});

			mounted.push(component);
		});
	}

	return () => {
		for (const c of mounted) {
			unmount(c);
		}
	};
}
