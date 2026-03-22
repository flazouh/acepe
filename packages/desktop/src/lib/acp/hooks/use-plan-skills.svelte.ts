/**
 * Skill detection and auto-install hook for plan action buttons.
 *
 * Checks whether compound engineering slash commands (/ce:review, /deepen-plan)
 * are installed for the current agent. If missing, fetches the skill content
 * from GitHub and installs it as a new agent skill.
 *
 * Skills are SKILL.md files that live in the agent's skills directory:
 * - ~/.claude/skills/ce-review/SKILL.md     → /ce:review
 * - ~/.claude/skills/deepen-plan/SKILL.md   → /deepen-plan
 *
 * Source: https://github.com/mvanhorn/compound-engineering-plugin
 */

import { okAsync, ResultAsync } from "neverthrow";
import { skillsApi } from "../../skills/api/skills-api.js";
import type { SkillTreeNode } from "../../skills/types/index.js";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "use-plan-skills", name: "UsePlanSkills" });

/**
 * Agent-side folder names for the compound engineering skills.
 * These correspond to directories under ~/.claude/skills/ (or equivalent).
 */
const CE_REVIEW_FOLDER = "ce-review";
const DEEPEN_PLAN_FOLDER = "deepen-plan";

/**
 * GitHub raw URLs for fetching skill content when not installed.
 * Pinned to a specific commit for stability.
 */
const GITHUB_BASE =
	"https://raw.githubusercontent.com/mvanhorn/compound-engineering-plugin/dad8dc74ec30b095d55c7aec6a4cbd29ec7d090d/plugins/compound-engineering/commands/ce";

const SKILL_SOURCES: Record<string, { url: string; name: string; description: string }> = {
	[CE_REVIEW_FOLDER]: {
		url: `${GITHUB_BASE}/review.md`,
		name: "ce:review",
		description: "Perform exhaustive code reviews using multi-agent analysis",
	},
	[DEEPEN_PLAN_FOLDER]: {
		url: `${GITHUB_BASE}/plan.md`,
		name: "ce:plan",
		description: "Transform feature descriptions into well-structured project plans",
	},
};

export interface PlanSkillState {
	/** Whether the initial skill check has completed */
	readonly loaded: boolean;
	/** Whether /ce:review is installed for the current agent */
	readonly hasReview: boolean;
	/** Whether /deepen-plan (via ce:plan) is installed for the current agent */
	readonly hasDeepen: boolean;
	/** Whether an install operation is in progress */
	readonly installing: boolean;
}

export function usePlanSkills(getAgentId: () => string | undefined) {
	let loaded = $state(false);
	let hasReview = $state(false);
	let hasDeepen = $state(false);
	let installing = $state(false);

	// Track last checked agentId to avoid redundant re-checks
	let lastCheckedAgentId: string | undefined;

	/**
	 * Check whether the compound engineering skills are installed for the given agent.
	 * Only checks the agent's skill tree — no plugin lookup.
	 */
	function checkSkills(): void {
		const agentId = getAgentId();
		if (!agentId) return;
		if (agentId === lastCheckedAgentId && loaded) return;

		lastCheckedAgentId = agentId;

		skillsApi.listTree().match(
			(tree) => {
				const agentNode = tree.find(
					(n: SkillTreeNode) => n.nodeType === "agent" && n.agentId === agentId
				);

				hasReview = agentNode ? hasSkillInTree(agentNode, CE_REVIEW_FOLDER) : false;
				hasDeepen = agentNode ? hasSkillInTree(agentNode, DEEPEN_PLAN_FOLDER) : false;
				loaded = true;

				logger.debug("Plan skills check complete", {
					agentId,
					hasReview,
					hasDeepen,
				});
			},
			(err) => {
				logger.warn("Failed to check plan skills", { error: err });
				loaded = true;
			}
		);
	}

	/**
	 * Fetch skill content from GitHub and install it for the current agent.
	 *
	 * Flow: fetch raw markdown from GitHub → createSkill → updateSkill with fetched content.
	 */
	function installSkill(folderName: string): ResultAsync<void, AppError> {
		const agentId = getAgentId();
		const source = SKILL_SOURCES[folderName];
		if (!agentId || !source) {
			return okAsync(undefined);
		}

		installing = true;
		logger.debug("Installing skill from GitHub", { folderName, agentId, url: source.url });

		// 1. Fetch content from GitHub
		return (
			fetchSkillContent(source.url)
				// 2. Create the skill folder + stub SKILL.md
				.andThen((content) =>
					skillsApi
						.createSkill(agentId, folderName, source.name, source.description)
						// 3. Update with the real content from GitHub
						.andThen((skill) => skillsApi.updateSkill(skill.id, content))
						.map((_updated) => {
							installing = false;
							// Invalidate cache so next checkSkills re-fetches
							lastCheckedAgentId = undefined;
							checkSkills();
							return undefined;
						})
				)
				.mapErr((err) => {
					installing = false;
					logger.error("Failed to install skill from GitHub", {
						folderName,
						agentId,
						error: err,
					});
					return err;
				})
		);
	}

	/**
	 * Install the /ce:review skill for the current agent.
	 */
	function installReview(): ResultAsync<void, AppError> {
		return installSkill(CE_REVIEW_FOLDER);
	}

	/**
	 * Install the /deepen-plan skill for the current agent.
	 */
	function installDeepen(): ResultAsync<void, AppError> {
		return installSkill(DEEPEN_PLAN_FOLDER);
	}

	// Run initial check via effect when agentId becomes available
	$effect(() => {
		const agentId = getAgentId();
		if (agentId) {
			checkSkills();
		}
	});

	return {
		get loaded() {
			return loaded;
		},
		get hasReview() {
			return hasReview;
		},
		get hasDeepen() {
			return hasDeepen;
		},
		get installing() {
			return installing;
		},
		installReview,
		installDeepen,
		checkSkills,
	};
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if a skill tree node (agent) has a skill with the given folder name */
function hasSkillInTree(agentNode: SkillTreeNode, folderName: string): boolean {
	return agentNode.children.some(
		(child) => child.nodeType === "skill" && child.id.endsWith(`::${folderName}`)
	);
}

/**
 * Fetch skill content (raw markdown) from a GitHub URL.
 * Wraps the browser fetch API in ResultAsync for neverthrow compatibility.
 */
function fetchSkillContent(url: string): ResultAsync<string, AppError> {
	return ResultAsync.fromPromise(
		globalThis.fetch(url).then((response) => {
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			return response.text();
		}),
		(err) => new AgentError(`fetch skill from GitHub`, err instanceof Error ? err : undefined)
	);
}
