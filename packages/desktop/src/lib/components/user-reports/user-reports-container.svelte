<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import { UserReportsModal } from "@acepe/ui/user-reports";
import type {
	GitHubService,
	GitHubError,
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

function wrapInvoke<T>(command: string, args?: Record<string, unknown>): ResultAsync<T, GitHubError> {
	return ResultAsync.fromPromise(
		invoke<T>(command, args),
		(error): GitHubError => {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("auth_required") || message.includes("401")) {
				return { kind: "auth_required", message };
			}
			if (message.includes("rate_limited") || message.includes("403")) {
				return { kind: "rate_limited", message };
			}
			if (message.includes("not_found") || message.includes("404")) {
				return { kind: "not_found", message };
			}
			if (message.includes("gh_not_installed") || message.includes("not found")) {
				return { kind: "gh_not_installed", message };
			}
			if (message.includes("network") || message.includes("ConnectionRefused")) {
				return { kind: "network", message };
			}
			return { kind: "unknown", message };
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
		wrapInvoke<GitHubComment[]>("list_issue_comments", { issueNumber, page }),

	createComment: (issueNumber, body) =>
		wrapInvoke<GitHubComment>("create_issue_comment", { issueNumber, body }),

	toggleIssueReaction: (issueNumber, content) =>
		wrapInvoke<boolean>("toggle_issue_reaction", { issueNumber, content }),

	toggleCommentReaction: (commentId, content) =>
		wrapInvoke<boolean>("toggle_comment_reaction", { commentId, content }),
};
</script>

<UserReportsModal {open} {service} repoUrl="https://github.com/flazouh/acepe" {onClose} />
