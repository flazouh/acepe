/**
 * Type-safe Tauri command client.
 *
 * Assembled from domain-specific sub-clients. Each sub-client handles its own
 * commands and types.
 */

import { acp } from "./acp.js";
import { checkpoint } from "./checkpoint.js";
import { fileIndex } from "./file-index.js";
import { fs } from "./fs.js";
import { git } from "./git.js";
import { history } from "./history.js";
import { projects } from "./projects.js";
import { sessionReviewState } from "./session-review-state.js";
import { settings } from "./settings.js";
import { shell } from "./shell.js";
import { skills } from "./skills.js";
import { sqlStudio } from "./sql-studio.js";
import { terminal } from "./terminal.js";
import { workspace } from "./workspace.js";

export const tauriClient = {
	acp,
	checkpoint,
	fileIndex,
	fs,
	git,
	history,
	projects,
	sessionReviewState,
	settings,
	shell,
	skills,
	sqlStudio,
	terminal,
	workspace,
} as const;

export { openFileInEditor, revealInFinder } from "./opener.js";
export type {
	CustomAgentConfig,
	HistorySessionMessage,
	ProjectData,
	ProjectInfo,
	ProjectSessionCounts,
	ThreadListSettings,
} from "./types.js";
