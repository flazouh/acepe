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
