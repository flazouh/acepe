import type { CreateReportInput, UpdateReportInput, UpdateReportStatusInput, ListReportsParams, ReportOutput, ReportListOutput } from './schemas/reports.js';
import type { CreateCommentInput, UpdateCommentInput, ListCommentsParams, CommentListOutput, CommentOutput } from './schemas/comments.js';
import type { CastVoteInput } from './schemas/votes.js';
import type { FollowOutput } from './schemas/followers.js';

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly body?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}

type QueryParams = Record<string, string | number | boolean | undefined>;

export interface ApiClient {
	reports: {
		list(params?: Partial<ListReportsParams>): Promise<ReportListOutput>;
		get(id: string): Promise<ReportOutput>;
		create(input: CreateReportInput): Promise<ReportOutput>;
		update(id: string, input: UpdateReportInput): Promise<ReportOutput>;
		delete(id: string): Promise<void>;
		updateStatus(id: string, input: UpdateReportStatusInput): Promise<ReportOutput>;
		vote(id: string, input: CastVoteInput): Promise<void>;
		removeVote(id: string): Promise<void>;
		follow(id: string): Promise<FollowOutput>;
		unfollow(id: string): Promise<FollowOutput>;
	};
	comments: {
		list(reportId: string, params?: Partial<ListCommentsParams>): Promise<CommentListOutput>;
		create(reportId: string, input: CreateCommentInput): Promise<CommentOutput>;
		update(reportId: string, commentId: string, input: UpdateCommentInput): Promise<CommentOutput>;
		delete(reportId: string, commentId: string): Promise<void>;
		vote(reportId: string, commentId: string, input: CastVoteInput): Promise<void>;
		removeVote(reportId: string, commentId: string): Promise<void>;
	};
}

export function createApiClient(baseUrl: string, getToken?: () => Promise<string | null>): ApiClient {
	async function fetchJson<T>(
		method: string,
		path: string,
		options?: { body?: unknown; query?: QueryParams }
	): Promise<T> {
		const url = new URL(path, baseUrl);

		if (options?.query) {
			for (const [key, value] of Object.entries(options.query)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (getToken) {
			const token = await getToken();
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}
		}

		const response = await fetch(url.toString(), {
			method,
			headers,
			body: options?.body ? JSON.stringify(options.body) : undefined
		});

		if (!response.ok) {
			const body = await response.text().catch(() => undefined);
			throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, body);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}

	return {
		reports: {
			list(params) {
				return fetchJson<ReportListOutput>('GET', '/api/reports', { query: params as QueryParams });
			},
			get(id) {
				return fetchJson<ReportOutput>('GET', `/api/reports/${id}`);
			},
			create(input) {
				return fetchJson<ReportOutput>('POST', '/api/reports', { body: input });
			},
			update(id, input) {
				return fetchJson<ReportOutput>('PATCH', `/api/reports/${id}`, { body: input });
			},
			delete(id) {
				return fetchJson<void>('DELETE', `/api/reports/${id}`);
			},
			updateStatus(id, input) {
				return fetchJson<ReportOutput>('PATCH', `/api/reports/${id}/status`, { body: input });
			},
			vote(id, input) {
				return fetchJson<void>('PUT', `/api/reports/${id}/vote`, { body: input });
			},
			removeVote(id) {
				return fetchJson<void>('DELETE', `/api/reports/${id}/vote`);
			},
			follow(id) {
				return fetchJson<FollowOutput>('PUT', `/api/reports/${id}/follow`);
			},
			unfollow(id) {
				return fetchJson<FollowOutput>('DELETE', `/api/reports/${id}/follow`);
			}
		},
		comments: {
			list(reportId, params) {
				return fetchJson<CommentListOutput>('GET', `/api/reports/${reportId}/comments`, {
					query: params as QueryParams
				});
			},
			create(reportId, input) {
				return fetchJson<CommentOutput>('POST', `/api/reports/${reportId}/comments`, { body: input });
			},
			update(reportId, commentId, input) {
				return fetchJson<CommentOutput>('PATCH', `/api/reports/${reportId}/comments/${commentId}`, {
					body: input
				});
			},
			delete(reportId, commentId) {
				return fetchJson<void>('DELETE', `/api/reports/${reportId}/comments/${commentId}`);
			},
			vote(reportId, commentId, input) {
				return fetchJson<void>('PUT', `/api/reports/${reportId}/comments/${commentId}/vote`, {
					body: input
				});
			},
			removeVote(reportId, commentId) {
				return fetchJson<void>('DELETE', `/api/reports/${reportId}/comments/${commentId}/vote`);
			}
		}
	};
}
