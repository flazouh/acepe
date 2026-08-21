import * as Effect from "effect/Effect";

import type {
	ArchivedSessionRef,
	ThreadListSettings,
} from "../../services/thread-list-settings.js";
import { getThreadListSettingsService } from "../../services/thread-list-settings.js";
import type { SessionDisplayItem } from "../types/thread-display-item.js";

export interface ArchiveSessionIdentity {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
}

export type ArchiveSessionLike = ArchivedSessionRef | ArchiveSessionIdentity | SessionDisplayItem;

interface ThreadListSettingsClientLike {
	getSettings(): Effect.Effect<ThreadListSettings, Error>;
	saveSettings(settings: ThreadListSettings): Effect.Effect<void, Error>;
}

interface NormalizedThreadListSettings {
	hiddenProjects: string[];
	archivedSessions: ArchivedSessionRef[];
}

export function normalizeThreadListSettings(input: {
	readonly hiddenProjects?: readonly string[];
	readonly archivedSessions?: readonly ArchivedSessionRef[];
}): NormalizedThreadListSettings {
	return {
		hiddenProjects: [...(input.hiddenProjects ?? [])],
		archivedSessions: [...(input.archivedSessions ?? [])],
	};
}

export function toArchivedSessionRef(session: ArchiveSessionLike): ArchivedSessionRef {
	if ("sessionId" in session) {
		return {
			sessionId: session.sessionId,
			projectPath: session.projectPath,
			agentId: session.agentId,
		};
	}

	return {
		sessionId: session.id,
		projectPath: session.projectPath,
		agentId: session.agentId,
	};
}

export function createArchivedSessionKey(session: ArchiveSessionLike): string {
	const ref = toArchivedSessionRef(session);
	return `${ref.agentId}::${ref.projectPath}::${ref.sessionId}`;
}

function dedupeArchivedSessions(sessions: readonly ArchivedSessionRef[]): ArchivedSessionRef[] {
	const seen = new Set<string>();
	const result: ArchivedSessionRef[] = [];

	for (const session of sessions) {
		const key = createArchivedSessionKey(session);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(session);
	}

	return result;
}

export class SessionArchiveStore {
	archivedSessions = $state<ArchivedSessionRef[]>([]);
	hiddenProjects = $state<string[]>([]);
	loaded = $state(false);
	loading = $state(false);

	constructor(
		private readonly settingsClient: ThreadListSettingsClientLike = getThreadListSettingsService()
	) {}

	load(): Effect.Effect<void, Error> {
		this.loading = true;
		return this.settingsClient.getSettings().pipe(
			Effect.map((settings) => {
				const normalized = normalizeThreadListSettings(settings);
				this.hiddenProjects = normalized.hiddenProjects;
				this.archivedSessions = dedupeArchivedSessions(normalized.archivedSessions);
				this.loaded = true;
				this.loading = false;
			}),
			Effect.mapError((error) => {
				this.loading = false;
				return error;
			})
		);
	}

	isArchived(session: ArchiveSessionLike): boolean {
		const key = createArchivedSessionKey(session);
		return this.archivedSessions.some((item) => createArchivedSessionKey(item) === key);
	}

	archive(session: ArchiveSessionLike): Effect.Effect<void, Error> {
		const ref = toArchivedSessionRef(session);

		if (this.isArchived(ref)) {
			return Effect.succeed(undefined);
		}

		const nextSettings = this.buildNextSettings([...this.archivedSessions, ref]);
		return this.persistSettings(nextSettings);
	}

	unarchive(session: ArchiveSessionLike): Effect.Effect<void, Error> {
		const targetKey = createArchivedSessionKey(session);
		const nextArchivedSessions = this.archivedSessions.filter(
			(item) => createArchivedSessionKey(item) !== targetKey
		);

		if (nextArchivedSessions.length === this.archivedSessions.length) {
			return Effect.succeed(undefined);
		}

		const nextSettings = this.buildNextSettings(nextArchivedSessions);
		return this.persistSettings(nextSettings);
	}

	toggle(session: ArchiveSessionLike): Effect.Effect<void, Error> {
		return this.isArchived(session) ? this.unarchive(session) : this.archive(session);
	}

	private buildNextSettings(archivedSessions: readonly ArchivedSessionRef[]): ThreadListSettings {
		return {
			hiddenProjects: [...this.hiddenProjects],
			archivedSessions: dedupeArchivedSessions(archivedSessions),
		};
	}

	private persistSettings(settings: ThreadListSettings): Effect.Effect<void, Error> {
		return this.settingsClient.saveSettings(settings).pipe(
			Effect.map(() => {
				const normalized = normalizeThreadListSettings(settings);
				this.hiddenProjects = normalized.hiddenProjects;
				this.archivedSessions = normalized.archivedSessions;
				this.loaded = true;
			})
		);
	}
}

let sessionArchiveStore: SessionArchiveStore | null = null;

export function getSessionArchiveStore(): SessionArchiveStore {
	if (sessionArchiveStore === null) {
		sessionArchiveStore = new SessionArchiveStore(getThreadListSettingsService());
		void Effect.runPromise(
			sessionArchiveStore.load().pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: () => undefined,
				})
			)
		);
	}

	return sessionArchiveStore;
}
