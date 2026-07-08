import { okAsync, type ResultAsync } from "neverthrow";
import type { GitStackedPrStep } from "../../../utils/tauri-client/git.js";
import { getRepoContext } from "../../services/github-service.js";

type SessionPrLinkCandidate = {
	readonly owner: string;
	readonly repo: string;
	readonly prNumber: number;
};

function parseGithubPullRequestUrl(url: string): SessionPrLinkCandidate | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	if (parsed.hostname !== "github.com") {
		return null;
	}

	const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
	if (segments.length !== 4) {
		return null;
	}

	const [owner, repo, resource, numberText] = segments;
	if (resource !== "pull") {
		return null;
	}

	const prNumber = Number.parseInt(numberText, 10);
	if (!Number.isInteger(prNumber) || prNumber <= 0) {
		return null;
	}

	return {
		owner,
		repo,
		prNumber,
	};
}

function namesMatchCaseInsensitive(left: string, right: string): boolean {
	return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

// A real `gh pr create` invocation is the verified create/open action (origin R2).
// We deliberately do NOT treat passive PR mentions or rendered chips as a signal (R3) —
// only the command that creates the PR, paired with the PR URL it prints, qualifies.
const GH_PR_CREATE_COMMAND_PATTERN = /\bgh\s+pr\s+create\b/u;
const GITHUB_PR_URL_IN_TEXT_PATTERN =
	/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/gu;

/**
 * Extracts a PR link candidate from a completed `gh pr create` tool call: the command
 * proves the verified create action, and the first PR URL printed in its output supplies
 * the concrete PR. Returns null when the command is not a PR-create or no PR URL was
 * printed. Pure and synchronous — repository ownership is validated by the resolver below.
 */
export function extractPrCandidateFromGhCreateToolCall(
	command: string | null | undefined,
	resultText: string | null | undefined
): SessionPrLinkCandidate | null {
	if (command == null || !GH_PR_CREATE_COMMAND_PATTERN.test(command)) {
		return null;
	}

	if (resultText == null) {
		return null;
	}

	GITHUB_PR_URL_IN_TEXT_PATTERN.lastIndex = 0;
	const match = GITHUB_PR_URL_IN_TEXT_PATTERN.exec(resultText);
	if (match === null) {
		return null;
	}

	return parseGithubPullRequestUrl(match[0]);
}

/**
 * Resolves the auto-link PR number from a completed `gh pr create` tool call, accepting it
 * only when the printed PR belongs to the session's current repository (origin R4). Mirrors
 * the ship-workflow resolver: fails closed (returns null) on any mismatch or lookup failure.
 */
export function resolveAutomaticSessionPrNumberFromToolCall(
	projectPath: string,
	command: string | null | undefined,
	resultText: string | null | undefined
): ResultAsync<number | null, never> {
	const candidate = extractPrCandidateFromGhCreateToolCall(command, resultText);
	if (candidate === null) {
		return okAsync(null);
	}

	return getRepoContext(projectPath)
		.map((repoContext) => {
			if (
				!namesMatchCaseInsensitive(repoContext.owner, candidate.owner) ||
				!namesMatchCaseInsensitive(repoContext.repo, candidate.repo)
			) {
				return null;
			}

			return candidate.prNumber;
		})
		.orElse(() => okAsync(null));
}

export function resolveAutomaticSessionPrNumberFromShipWorkflow(
	projectPath: string,
	pr: GitStackedPrStep
): ResultAsync<number | null, never> {
	if (pr.status !== "created" && pr.status !== "opened_existing") {
		return okAsync(null);
	}

	if (pr.number == null || pr.number <= 0 || pr.url == null) {
		return okAsync(null);
	}

	const parsed = parseGithubPullRequestUrl(pr.url);
	if (parsed === null || parsed.prNumber !== pr.number) {
		return okAsync(null);
	}

	return getRepoContext(projectPath)
		.map((repoContext) => {
			if (
				!namesMatchCaseInsensitive(repoContext.owner, parsed.owner) ||
				!namesMatchCaseInsensitive(repoContext.repo, parsed.repo)
			) {
				return null;
			}

			return pr.number ?? null;
		})
		.orElse(() => okAsync(null));
}
