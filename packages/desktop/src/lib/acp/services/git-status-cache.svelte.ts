import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { findGitStatusForFile, getRelativeFilePath } from "$lib/acp/utils/file-utils.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

type FetchGitStatus = (projectPath: string) => ResultAsync<ReadonlyArray<FileGitStatus>, AppError>;
type FetchFileGitStatus = (
	projectPath: string,
	filePath: string
) => ResultAsync<FileGitStatus | null, AppError>;

type GitStatusCacheEntry<T = ReadonlyMap<string, FileGitStatus>> = {
	expiresAt: number;
	statusMap: T;
};

type CreateGitStatusCacheOptions = {
	ttlMs?: number;
	now?: () => number;
	fetchGitStatus?: FetchGitStatus;
	fetchGitStatusSummary?: FetchGitStatus;
	fetchFileGitStatusSummary?: FetchFileGitStatus;
};

type GitStatusCacheApi = {
	getProjectGitStatusMap: (
		projectPath: string
	) => ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>;
	getProjectGitStatusSummaryMap: (
		projectPath: string
	) => ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>;
	getProjectFileGitStatusSummary: (
		projectPath: string,
		filePath: string
	) => ResultAsync<FileGitStatus | null, AppError>;
	invalidateProjectGitStatus: (projectPath: string) => void;
};

const DEFAULT_TTL_MS = 2000;

function createFileSummaryCacheKey(projectPath: string, filePath: string): string {
	return `${projectPath}\0${filePath}`;
}

function buildStatusMap(
	statuses: ReadonlyArray<FileGitStatus>
): ReadonlyMap<string, FileGitStatus> {
	const map = new Map<string, FileGitStatus>();
	for (const status of statuses) {
		map.set(status.path, status);
	}
	return map;
}

function selectFileStatusFromSummaryMap(
	statusMap: ReadonlyMap<string, FileGitStatus>,
	projectPath: string,
	filePath: string
): FileGitStatus | null {
	const relativeFilePath = getRelativeFilePath(filePath, projectPath);
	if (relativeFilePath === null) {
		return null;
	}
	return (
		statusMap.get(relativeFilePath) ??
		findGitStatusForFile(Array.from(statusMap.values()), filePath, projectPath)
	);
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
	const fetchFileGitStatusSummary =
		options?.fetchFileGitStatusSummary ??
		((projectPath: string, filePath: string): ResultAsync<FileGitStatus | null, AppError> =>
			tauriClient.fileIndex.getFileGitStatusSummary(projectPath, filePath));

	const cacheByProject = new Map<string, GitStatusCacheEntry>();
	const summaryCacheByProject = new Map<string, GitStatusCacheEntry>();
	const fileSummaryCacheByProjectAndPath = new Map<
		string,
		GitStatusCacheEntry<FileGitStatus | null>
	>();
	const inflightByProject = new Map<
		string,
		ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>
	>();
	const summaryInflightByProject = new Map<
		string,
		ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>
	>();
	const fileSummaryInflightByProjectAndPath = new Map<
		string,
		ResultAsync<FileGitStatus | null, AppError>
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

	function getProjectFileGitStatusSummary(
		projectPath: string,
		filePath: string
	): ResultAsync<FileGitStatus | null, AppError> {
		const cachedSummary = summaryCacheByProject.get(projectPath);
		if (cachedSummary && cachedSummary.expiresAt > now()) {
			return okAsync(selectFileStatusFromSummaryMap(cachedSummary.statusMap, projectPath, filePath));
		}

		const cacheKey = createFileSummaryCacheKey(projectPath, filePath);
		const cached = fileSummaryCacheByProjectAndPath.get(cacheKey);
		if (cached && cached.expiresAt > now()) {
			return okAsync(cached.statusMap);
		}

		const existingRequest = fileSummaryInflightByProjectAndPath.get(cacheKey);
		if (existingRequest) {
			return existingRequest;
		}

		const request = fetchFileGitStatusSummary(projectPath, filePath)
			.map((status) => {
				fileSummaryCacheByProjectAndPath.set(cacheKey, {
					expiresAt: now() + ttlMs,
					statusMap: status,
				});
				fileSummaryInflightByProjectAndPath.delete(cacheKey);
				return status;
			})
			.mapErr((error) => {
				fileSummaryInflightByProjectAndPath.delete(cacheKey);
				return error;
			});

		fileSummaryInflightByProjectAndPath.set(cacheKey, request);
		return request;
	}

	function invalidateProjectGitStatus(projectPath: string): void {
		cacheByProject.delete(projectPath);
		summaryCacheByProject.delete(projectPath);
		inflightByProject.delete(projectPath);
		summaryInflightByProject.delete(projectPath);
		for (const cacheKey of fileSummaryCacheByProjectAndPath.keys()) {
			if (cacheKey.startsWith(`${projectPath}\0`)) {
				fileSummaryCacheByProjectAndPath.delete(cacheKey);
			}
		}
		for (const cacheKey of fileSummaryInflightByProjectAndPath.keys()) {
			if (cacheKey.startsWith(`${projectPath}\0`)) {
				fileSummaryInflightByProjectAndPath.delete(cacheKey);
			}
		}
	}

	return {
		getProjectGitStatusMap,
		getProjectGitStatusSummaryMap,
		getProjectFileGitStatusSummary,
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

export function getProjectFileGitStatusSummary(
	projectPath: string,
	filePath: string
): ResultAsync<FileGitStatus | null, AppError> {
	return gitStatusCache.getProjectFileGitStatusSummary(projectPath, filePath);
}

export function invalidateProjectGitStatus(projectPath: string): void {
	gitStatusCache.invalidateProjectGitStatus(projectPath);
}
