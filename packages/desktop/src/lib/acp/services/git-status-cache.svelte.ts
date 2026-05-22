import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

type FetchGitStatus = (projectPath: string) => ResultAsync<ReadonlyArray<FileGitStatus>, AppError>;

type GitStatusCacheEntry = {
	expiresAt: number;
	statusMap: ReadonlyMap<string, FileGitStatus>;
};

type CreateGitStatusCacheOptions = {
	ttlMs?: number;
	now?: () => number;
	fetchGitStatus?: FetchGitStatus;
	fetchGitStatusSummary?: FetchGitStatus;
};

type GitStatusCacheApi = {
	getProjectGitStatusMap: (
		projectPath: string
	) => ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>;
	getProjectGitStatusSummaryMap: (
		projectPath: string
	) => ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>;
	invalidateProjectGitStatus: (projectPath: string) => void;
};

const DEFAULT_TTL_MS = 2000;

function buildStatusMap(
	statuses: ReadonlyArray<FileGitStatus>
): ReadonlyMap<string, FileGitStatus> {
	const map = new Map<string, FileGitStatus>();
	for (const status of statuses) {
		map.set(status.path, status);
	}
	return map;
}

export function createGitStatusCache(options?: CreateGitStatusCacheOptions): GitStatusCacheApi {
	const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
	const now = options?.now ?? (() => Date.now());
	const fetchGitStatus =
		options?.fetchGitStatus ??
		((projectPath: string): ResultAsync<ReadonlyArray<FileGitStatus>, AppError> =>
			tauriClient.fileIndex.getProjectGitStatus(projectPath));
	const fetchGitStatusSummary =
		options?.fetchGitStatusSummary ??
		((projectPath: string): ResultAsync<ReadonlyArray<FileGitStatus>, AppError> =>
			tauriClient.fileIndex.getProjectGitStatusSummary(projectPath));

	const cacheByProject = new Map<string, GitStatusCacheEntry>();
	const summaryCacheByProject = new Map<string, GitStatusCacheEntry>();
	const inflightByProject = new Map<
		string,
		ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>
	>();
	const summaryInflightByProject = new Map<
		string,
		ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>
	>();

	function getCachedProjectStatusMap(
		projectPath: string,
		cache: Map<string, GitStatusCacheEntry>,
		inflight: Map<string, ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>>,
		fetch: FetchGitStatus
	): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
		const cached = cache.get(projectPath);
		if (cached && cached.expiresAt > now()) {
			return okAsync(cached.statusMap);
		}

		const existingRequest = inflight.get(projectPath);
		if (existingRequest) {
			return existingRequest;
		}

		const request = fetch(projectPath)
			.map((statuses) => {
				const statusMap = buildStatusMap(statuses);
				cache.set(projectPath, {
					expiresAt: now() + ttlMs,
					statusMap,
				});
				inflight.delete(projectPath);
				return statusMap;
			})
			.mapErr((error) => {
				inflight.delete(projectPath);
				return error;
			});

		inflight.set(projectPath, request);
		return request;
	}

	function getProjectGitStatusMap(
		projectPath: string
	): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
		return getCachedProjectStatusMap(
			projectPath,
			cacheByProject,
			inflightByProject,
			fetchGitStatus
		);
	}

	function getProjectGitStatusSummaryMap(
		projectPath: string
	): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
		return getCachedProjectStatusMap(
			projectPath,
			summaryCacheByProject,
			summaryInflightByProject,
			fetchGitStatusSummary
		);
	}

	function invalidateProjectGitStatus(projectPath: string): void {
		cacheByProject.delete(projectPath);
		summaryCacheByProject.delete(projectPath);
		inflightByProject.delete(projectPath);
		summaryInflightByProject.delete(projectPath);
	}

	return {
		getProjectGitStatusMap,
		getProjectGitStatusSummaryMap,
		invalidateProjectGitStatus,
	};
}

export const gitStatusCache = createGitStatusCache();

export function getProjectGitStatusMap(
	projectPath: string
): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
	return gitStatusCache.getProjectGitStatusMap(projectPath);
}

export function getProjectGitStatusSummaryMap(
	projectPath: string
): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
	return gitStatusCache.getProjectGitStatusSummaryMap(projectPath);
}

export function invalidateProjectGitStatus(projectPath: string): void {
	gitStatusCache.invalidateProjectGitStatus(projectPath);
}
