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
};

type GitStatusCacheApi = {
	getProjectGitStatusMap: (
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

	const cacheByProject = new Map<string, GitStatusCacheEntry>();
	const inflightByProject = new Map<
		string,
		ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError>
	>();

	function getProjectGitStatusMap(
		projectPath: string
	): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
		const cached = cacheByProject.get(projectPath);
		if (cached && cached.expiresAt > now()) {
			return okAsync(cached.statusMap);
		}

		const inflight = inflightByProject.get(projectPath);
		if (inflight) {
			return inflight;
		}

		const request = fetchGitStatus(projectPath)
			.map((statuses) => {
				const statusMap = buildStatusMap(statuses);
				cacheByProject.set(projectPath, {
					expiresAt: now() + ttlMs,
					statusMap,
				});
				inflightByProject.delete(projectPath);
				return statusMap;
			})
			.mapErr((error) => {
				inflightByProject.delete(projectPath);
				return error;
			});

		inflightByProject.set(projectPath, request);
		return request;
	}

	function invalidateProjectGitStatus(projectPath: string): void {
		cacheByProject.delete(projectPath);
		inflightByProject.delete(projectPath);
	}

	return {
		getProjectGitStatusMap,
		invalidateProjectGitStatus,
	};
}

export const gitStatusCache = createGitStatusCache();

export function getProjectGitStatusMap(
	projectPath: string
): ResultAsync<ReadonlyMap<string, FileGitStatus>, AppError> {
	return gitStatusCache.getProjectGitStatusMap(projectPath);
}

export function invalidateProjectGitStatus(projectPath: string): void {
	gitStatusCache.invalidateProjectGitStatus(projectPath);
}
