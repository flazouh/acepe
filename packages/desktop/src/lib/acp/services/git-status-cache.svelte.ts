import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { AgentError, AppError } from "$lib/acp/errors/app-error.js";
import { getRelativeFilePath } from "$lib/acp/utils/file-utils.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

type FetchGitStatus = (projectPath: string) => Effect.Effect<ReadonlyArray<FileGitStatus>, AppError>;
type FetchFileGitStatus = (
	projectPath: string,
	filePath: string
) => Effect.Effect<FileGitStatus | null, AppError>;

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
	) => Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError>;
	getProjectGitStatusSummaryMap: (
		projectPath: string
	) => Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError>;
	getProjectFileGitStatusSummary: (
		projectPath: string,
		filePath: string
	) => Effect.Effect<FileGitStatus | null, AppError>;
	invalidateProjectGitStatus: (projectPath: string) => void;
};

const DEFAULT_TTL_MS = 2000;

function toGitStatusCacheError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}
	return new AgentError(
		"git-status-cache",
		error instanceof Error ? error : new Error(String(error))
	);
}

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
	for (const key of createFileStatusLookupKeys(projectPath, filePath)) {
		const status = statusMap.get(key);
		if (status !== undefined) {
			return status;
		}
	}
	return null;
}

function createFileStatusLookupKeys(projectPath: string, filePath: string): string[] {
	const keys: string[] = [];
	const seen = new Set<string>();

	function addKey(value: string | null | undefined): void {
		if (value === null || value === undefined || value.length === 0) {
			return;
		}
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		keys.push(value);
	}

	const relativeFilePath = getRelativeFilePath(filePath, projectPath);
	addKey(relativeFilePath);
	addKey(normalizeGitStatusLookupKey(relativeFilePath));
	addKey(normalizeGitStatusLookupKey(filePath));
	return keys;
}

function normalizeGitStatusLookupKey(path: string | null | undefined): string | null {
	if (path === null || path === undefined || path.length === 0) {
		return null;
	}

	const normalizedSlashes = path.replaceAll("\\", "/");
	if (normalizedSlashes.startsWith("./")) {
		return normalizedSlashes.slice(2);
	}
	if (normalizedSlashes.startsWith("/")) {
		return normalizedSlashes.slice(1);
	}
	return normalizedSlashes;
}

export function createGitStatusCache(options?: CreateGitStatusCacheOptions): GitStatusCacheApi {
	const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
	const now = options?.now ?? (() => Date.now());
	const fetchGitStatus =
		options?.fetchGitStatus ??
		((projectPath: string): Effect.Effect<ReadonlyArray<FileGitStatus>, AppError> =>
			tauriClient.fileIndex.getProjectGitStatus(projectPath));
	const fetchGitStatusSummary =
		options?.fetchGitStatusSummary ??
		((projectPath: string): Effect.Effect<ReadonlyArray<FileGitStatus>, AppError> =>
			tauriClient.fileIndex.getProjectGitStatusSummary(projectPath));
	const fetchFileGitStatusSummary =
		options?.fetchFileGitStatusSummary ??
		((projectPath: string, filePath: string): Effect.Effect<FileGitStatus | null, AppError> =>
			tauriClient.fileIndex.getFileGitStatusSummary(projectPath, filePath));

	const cacheByProject = new Map<string, GitStatusCacheEntry>();
	const summaryCacheByProject = new Map<string, GitStatusCacheEntry>();
	const fileSummaryCacheByProjectAndPath = new Map<
		string,
		GitStatusCacheEntry<FileGitStatus | null>
	>();
	const inflightByProject = new Map<string, Promise<ReadonlyMap<string, FileGitStatus>>>();
	const summaryInflightByProject = new Map<string, Promise<ReadonlyMap<string, FileGitStatus>>>();
	const fileSummaryInflightByProjectAndPath = new Map<string, Promise<FileGitStatus | null>>();

	function getCachedProjectStatusMap(
		projectPath: string,
		cache: Map<string, GitStatusCacheEntry>,
		inflight: Map<string, Promise<ReadonlyMap<string, FileGitStatus>>>,
		fetch: FetchGitStatus
	): Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError> {
		const cached = cache.get(projectPath);
		if (cached && cached.expiresAt > now()) {
			return Effect.succeed(cached.statusMap);
		}

		const existingRequest = inflight.get(projectPath);
		if (existingRequest) {
			return fromPromise(() => existingRequest, toGitStatusCacheError);
		}

		const pending = Effect.runPromise(
			fetch(projectPath).pipe(
				Effect.map((statuses) => {
					const statusMap = buildStatusMap(statuses);
					cache.set(projectPath, {
						expiresAt: now() + ttlMs,
						statusMap,
					});
					return statusMap;
				})
			)
		).then(
			(statusMap) => {
				inflight.delete(projectPath);
				return statusMap;
			},
			(error: unknown) => {
				inflight.delete(projectPath);
				throw error;
			}
		);

		inflight.set(projectPath, pending);
		return fromPromise(() => pending, toGitStatusCacheError);
	}

	function getProjectGitStatusMap(
		projectPath: string
	): Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError> {
		return getCachedProjectStatusMap(
			projectPath,
			cacheByProject,
			inflightByProject,
			fetchGitStatus
		);
	}

	function getProjectGitStatusSummaryMap(
		projectPath: string
	): Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError> {
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
	): Effect.Effect<FileGitStatus | null, AppError> {
		const cachedSummary = summaryCacheByProject.get(projectPath);
		if (cachedSummary && cachedSummary.expiresAt > now()) {
			const cachedFileStatus = selectFileStatusFromSummaryMap(
				cachedSummary.statusMap,
				projectPath,
				filePath
			);
			if (cachedFileStatus !== null) {
				return Effect.succeed(cachedFileStatus);
			}
		}

		const cacheKey = createFileSummaryCacheKey(projectPath, filePath);
		const cached = fileSummaryCacheByProjectAndPath.get(cacheKey);
		if (cached && cached.expiresAt > now()) {
			return Effect.succeed(cached.statusMap);
		}

		const existingRequest = fileSummaryInflightByProjectAndPath.get(cacheKey);
		if (existingRequest) {
			return fromPromise(() => existingRequest, toGitStatusCacheError);
		}

		const pending = Effect.runPromise(
			fetchFileGitStatusSummary(projectPath, filePath).pipe(
				Effect.map((status) => {
					fileSummaryCacheByProjectAndPath.set(cacheKey, {
						expiresAt: now() + ttlMs,
						statusMap: status,
					});
					return status;
				})
			)
		).then(
			(status) => {
				fileSummaryInflightByProjectAndPath.delete(cacheKey);
				return status;
			},
			(error: unknown) => {
				fileSummaryInflightByProjectAndPath.delete(cacheKey);
				throw error;
			}
		);

		fileSummaryInflightByProjectAndPath.set(cacheKey, pending);
		return fromPromise(() => pending, toGitStatusCacheError);
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
): Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError> {
	return gitStatusCache.getProjectGitStatusMap(projectPath);
}

export function getProjectGitStatusSummaryMap(
	projectPath: string
): Effect.Effect<ReadonlyMap<string, FileGitStatus>, AppError> {
	return gitStatusCache.getProjectGitStatusSummaryMap(projectPath);
}

export function getProjectFileGitStatusSummary(
	projectPath: string,
	filePath: string
): Effect.Effect<FileGitStatus | null, AppError> {
	return gitStatusCache.getProjectFileGitStatusSummary(projectPath, filePath);
}

export function invalidateProjectGitStatus(projectPath: string): void {
	gitStatusCache.invalidateProjectGitStatus(projectPath);
}
