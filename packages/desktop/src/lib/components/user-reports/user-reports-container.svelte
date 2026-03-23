<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import { UserReportsModal } from "@acepe/ui/user-reports";
import type {
	GitHubService,
	GitHubError,
	GitHubErrorKind,
	AuthStatus,
	IssueListResult,
	GitHubIssue,
	GitHubComment,
} from "@acepe/ui/user-reports";

interface Props {
	open: boolean;
	onClose: () => void;
}

let { open, onClose }: Props = $props();

const ERROR_CODE_KINDS: GitHubErrorKind[] = [
	"auth_required",
	"rate_limited",
	"not_found",
	"gh_not_installed",
	"network",
];

function parseErrorKind(message: string): GitHubErrorKind {
	// Rust returns "ERROR_CODE: human-readable message" format
	const colonIndex = message.indexOf(": ");
	if (colonIndex > 0) {
		const prefix = message.slice(0, colonIndex);
		const matched = ERROR_CODE_KINDS.find((k) => k === prefix);
		if (matched) return matched;
	}
	return "unknown";
}

function wrapInvoke<T>(command: string, args?: Record<string, unknown>): ResultAsync<T, GitHubError> {
	return ResultAsync.fromPromise(
		invoke<T>(command, args),
		(error): GitHubError => {
			const message = error instanceof Error ? error.message : String(error);
			const kind = parseErrorKind(message);
			return { kind, message };
		}
	);
}

const service: GitHubService = {
	checkAuth: () => wrapInvoke<AuthStatus>("check_github_auth"),

	listIssues: (params) =>
		wrapInvoke<IssueListResult>("list_github_issues", {
			state: params.state,
			labels: params.labels,
			sort: params.sort,
			direction: params.direction,
			page: params.page,
			perPage: params.perPage,
		}),

	searchIssues: (params) =>
		wrapInvoke<IssueListResult>("search_github_issues", {
			query: params.query,
			state: params.state,
			labels: params.labels,
			sort: params.sort,
			page: params.page,
			perPage: params.perPage,
		}),

	getIssue: (number) => wrapInvoke<GitHubIssue>("get_github_issue", { number }),

	createIssue: (params) =>
		wrapInvoke<GitHubIssue>("create_github_issue", {
			title: params.title,
			body: params.body,
			labels: params.labels,
		}),

	listComments: (issueNumber, page) =>
		wrapInvoke<GitHubComment[]>("list_issue_comments", { number: issueNumber, page }),

	createComment: (issueNumber, body) =>
		wrapInvoke<GitHubComment>("create_issue_comment", { number: issueNumber, body }),

	toggleIssueReaction: (issueNumber, content) =>
		wrapInvoke<boolean>("toggle_issue_reaction", { number: issueNumber, content }),

	toggleCommentReaction: (commentId, content) =>
		wrapInvoke<boolean>("toggle_comment_reaction", { commentId, content }),
};
</script>

<UserReportsModal {open} {service} repoUrl="https://github.com/flazouh/acepe" {onClose} />
