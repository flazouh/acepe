import type { FileGitStatus } from "$lib/services/converted-session-types.js";

import type { Project } from "../logic/project-manager.svelte.js";

export type ProjectCardData = {
	project: Project;
	branch: string | null;
	gitStatus: ReadonlyArray<FileGitStatus> | null;
};
