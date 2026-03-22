import { Result } from "neverthrow";
import { mount, unmount } from "svelte";

import type { GitHubReference } from "../../../constants/github-badge-html.js";
import GitHubBadge from "../../github-badge.svelte";
import { gitHubReferenceSchema } from "../block-types/github-badge.js";

export interface MountGitHubBadgesOptions {
	repoContext?: { owner: string; repo: string } | null;
	projectPath?: string | null;
}

/**
 * Finds github-badge-placeholder <span>s inside a container and mounts
 * GitHubBadge Svelte components into them. Returns a cleanup function that
 * unmounts all mounted components.
 *
 * Placeholders are inline <span>s that stay inside their parent elements
 * (li, p, etc.) so the HTML structure is never broken by block splitting.
 * Same injection pattern as file-path-badge (mountFileBadges).
 */
export function mountGitHubBadges(
	container: HTMLElement,
	options: MountGitHubBadgesOptions = {}
): () => void {
	const mounted: ReturnType<typeof mount>[] = [];
	const { repoContext, projectPath } = options;

	const placeholders = container.querySelectorAll(".github-badge-placeholder");
	for (const el of placeholders) {
		// Skip if already mounted (re-entrant guard)
		if (el.children.length > 0) continue;

		const encoded = el.getAttribute("data-github-ref");
		if (!encoded) continue;

		const refJson = decodeURIComponent(encoded).replace(/&quot;/g, '"');
		const parseResult = Result.fromThrowable(
			() => JSON.parse(refJson) as unknown,
			(error) => error
		)();

		parseResult.map((parsed) => {
			const validation = gitHubReferenceSchema.safeParse(parsed);
			if (!validation.success) return;

			const ref = validation.data as GitHubReference;

			const component = mount(GitHubBadge, {
				target: el as HTMLElement,
				props: {
					ref,
					repoContext: repoContext ?? undefined,
					projectPath: projectPath ?? undefined,
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
