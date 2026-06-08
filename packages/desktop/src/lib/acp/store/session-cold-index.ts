/**
 * SessionCold array + index helpers for the session store's session-list cold
 * data: lazy prepended/patched session arrays, by-id and by-project index
 * builders + incremental patches, and array removals. Pure list transforms — no
 * projection state. GOD-safe.
 */
import type { SessionCold, SessionMutableColdUpdates } from "./types.js";
import { SvelteMap } from "svelte/reactivity";
import { toArrayIndex } from "./array-index-utils.js";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";

export type SessionLiveSyncReference = {
	readonly id: string;
	readonly updatedAtMs: number;
};

export type SessionPaletteReference = {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly title: string | null;
};

export function createPrependedSessionColdArray(
	session: SessionCold,
	base: readonly SessionCold[]
): SessionCold[] {
	const target = new Array<SessionCold>(base.length + 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPrependedSessionCold(session, base, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPrependedSessionCold(session, base, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectPrependedSessionCold(session, base, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
}

function selectPrependedSessionCold(
	session: SessionCold,
	base: readonly SessionCold[],
	index: number
): SessionCold | undefined {
	return index === 0 ? session : base[index - 1];
}

export function createPatchedSessionColdArray(
	base: readonly SessionCold[],
	patchedIndex: number,
	session: SessionCold
): SessionCold[] {
	const target = new Array<SessionCold>(base.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === patchedIndex ? session : base[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === patchedIndex ? session : base[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index === patchedIndex ? session : base[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
}

export function findSessionColdIndexById(sessions: readonly SessionCold[], sessionId: string): number {
	for (let index = 0; index < sessions.length; index += 1) {
		if (sessions[index]?.id === sessionId) {
			return index;
		}
	}
	return -1;
}

export function rebuildSessionByIdIndex(
	index: SvelteMap<string, SessionCold>,
	sessions: readonly SessionCold[]
): void {
	index.clear();
	for (const session of sessions) {
		index.set(session.id, session);
	}
}

export function rebuildSessionsByProjectIndex(
	index: SvelteMap<string, SessionCold[]>,
	sessions: readonly SessionCold[]
): void {
	index.clear();
	for (const session of sessions) {
		const projectSessions = index.get(session.projectPath);
		if (projectSessions === undefined) {
			index.set(session.projectPath, [session]);
			continue;
		}
		projectSessions.push(session);
	}
}

export function rebuildSessionIdsByProjectIndex(
	index: SvelteMap<string, string[]>,
	sessions: readonly SessionCold[]
): void {
	index.clear();
	for (const session of sessions) {
		const projectSessionIds = index.get(session.projectPath);
		if (projectSessionIds === undefined) {
			index.set(session.projectPath, [session.id]);
			continue;
		}
		projectSessionIds.push(session.id);
	}
}

export function patchSessionsByProjectIndex(
	index: SvelteMap<string, SessionCold[]>,
	previousSession: SessionCold | undefined,
	nextSession: SessionCold
): void {
	if (previousSession !== undefined && previousSession.projectPath !== nextSession.projectPath) {
		const previousProjectSessions = index.get(previousSession.projectPath);
		if (previousProjectSessions !== undefined) {
			const nextPreviousProjectSessions = removeSessionColdFromArray(
				previousProjectSessions,
				previousSession.id
			);
			if (nextPreviousProjectSessions.length === 0) {
				index.delete(previousSession.projectPath);
			} else {
				index.set(previousSession.projectPath, nextPreviousProjectSessions);
			}
		}
	}

	const currentProjectSessions = index.get(nextSession.projectPath);
	if (currentProjectSessions === undefined) {
		index.set(nextSession.projectPath, [nextSession]);
		return;
	}

	const projectIndex = findSessionColdIndexById(currentProjectSessions, nextSession.id);
	if (projectIndex === -1) {
		index.set(
			nextSession.projectPath,
			createPrependedSessionColdArray(nextSession, currentProjectSessions)
		);
		return;
	}

	index.set(
		nextSession.projectPath,
		createPatchedSessionColdArray(currentProjectSessions, projectIndex, nextSession)
	);
}

export function patchSessionIdsByProjectIndex(
	index: SvelteMap<string, string[]>,
	previousSession: SessionCold | undefined,
	nextSession: SessionCold
): void {
	if (previousSession !== undefined && previousSession.projectPath !== nextSession.projectPath) {
		const previousProjectSessionIds = index.get(previousSession.projectPath);
		if (previousProjectSessionIds !== undefined) {
			const nextPreviousProjectSessionIds = removeSessionIdFromArray(
				previousProjectSessionIds,
				previousSession.id
			);
			if (nextPreviousProjectSessionIds.length === 0) {
				index.delete(previousSession.projectPath);
			} else {
				index.set(previousSession.projectPath, nextPreviousProjectSessionIds);
			}
		}
	}

	const currentProjectSessionIds = index.get(nextSession.projectPath);
	if (currentProjectSessionIds === undefined) {
		index.set(nextSession.projectPath, [nextSession.id]);
		return;
	}

	if (currentProjectSessionIds.includes(nextSession.id)) {
		return;
	}

	index.set(
		nextSession.projectPath,
		createPrependedReferenceArray(nextSession.id, currentProjectSessionIds)
	);
}

function removeSessionColdFromArray(
	sessions: readonly SessionCold[],
	sessionId: string
): SessionCold[] {
	const removedIndex = findSessionColdIndexById(sessions, sessionId);
	if (removedIndex === -1) {
		return sessions as SessionCold[];
	}
	const nextSessions: SessionCold[] = [];
	for (let index = 0; index < sessions.length; index += 1) {
		if (index !== removedIndex) {
			const session = sessions[index];
			if (session !== undefined) {
				nextSessions.push(session);
			}
		}
	}
	return nextSessions;
}

function removeSessionIdFromArray(sessionIds: readonly string[], sessionId: string): string[] {
	const removedIndex = sessionIds.indexOf(sessionId);
	if (removedIndex === -1) {
		return sessionIds as string[];
	}
	const nextSessionIds: string[] = [];
	for (let index = 0; index < sessionIds.length; index += 1) {
		if (index !== removedIndex) {
			const existingSessionId = sessionIds[index];
			if (existingSessionId !== undefined) {
				nextSessionIds.push(existingSessionId);
			}
		}
	}
	return nextSessionIds;
}


export function sessionLiveSyncReferenceFromSession(session: SessionCold): SessionLiveSyncReference {
	return {
		id: session.id,
		updatedAtMs: session.updatedAt.getTime(),
	};
}

export function sessionPaletteReferenceFromSession(session: SessionCold): SessionPaletteReference {
	return {
		id: session.id,
		projectPath: session.projectPath,
		agentId: session.agentId,
		title: session.title,
	};
}

export function createPrependedReferenceArray<TReference>(
	reference: TReference,
	base: readonly TReference[]
): TReference[] {
	const target = new Array<TReference>(base.length + 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === 0 ? reference : base[index - 1];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === 0 ? reference : base[index - 1];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index === 0 ? reference : base[index - 1],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
}

export function createPatchedReferenceArray<TReference extends { readonly id: string }>(
	base: readonly TReference[],
	reference: TReference
): TReference[] {
	const patchedIndex = findReferenceIndexById(base, reference.id);
	if (patchedIndex === -1) {
		return createPrependedReferenceArray(reference, base);
	}
	const target = new Array<TReference>(base.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === patchedIndex ? reference : base[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === patchedIndex ? reference : base[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index === patchedIndex ? reference : base[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
}

export function findReferenceIndexById<TReference extends { readonly id: string }>(
	references: readonly TReference[],
	id: string
): number {
	for (let index = 0; index < references.length; index += 1) {
		if (references[index]?.id === id) {
			return index;
		}
	}
	return -1;
}

export function rebuildLiveSessionSyncReferences(
	sessions: readonly SessionCold[]
): SessionLiveSyncReference[] {
	const references: SessionLiveSyncReference[] = [];
	for (const session of sessions) {
		references.push(sessionLiveSyncReferenceFromSession(session));
	}
	return references;
}

export function rebuildSessionPaletteReferences(
	sessions: readonly SessionCold[]
): SessionPaletteReference[] {
	const references: SessionPaletteReference[] = [];
	for (const session of sessions) {
		references.push(sessionPaletteReferenceFromSession(session));
	}
	return references;
}

/** Rebuild a SessionCold from an existing one (defensive copy via the canonical slice constructor). */
export function sessionColdFromExistingSession(session: SessionCold): SessionCold {
	return sessionColdFromSlices(
		{
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: session.worktreePath,
		},
		{
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			sourcePath: session.sourcePath,
			sessionLifecycleState: session.sessionLifecycleState,
			parentId: session.parentId,
			prNumber: session.prNumber,
			prState: session.prState,
			prLinkMode: session.prLinkMode,
			linkedPr: session.linkedPr,
			worktreeDeleted: session.worktreeDeleted,
			sequenceId: session.sequenceId,
		}
	);
}

/** Apply mutable cold updates to a SessionCold, producing a new instance with the given updatedAt. */
export function sessionColdWithMutableUpdates(
	session: SessionCold,
	updates: SessionMutableColdUpdates,
	updatedAt: Date
): SessionCold {
	return sessionColdFromSlices(
		{
			id: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
			worktreePath: "worktreePath" in updates ? updates.worktreePath : session.worktreePath,
		},
		{
			title: updates.title !== undefined ? updates.title : session.title,
			createdAt: updates.createdAt !== undefined ? updates.createdAt : session.createdAt,
			updatedAt,
			sourcePath: "sourcePath" in updates ? updates.sourcePath : session.sourcePath,
			sessionLifecycleState:
				"sessionLifecycleState" in updates
					? updates.sessionLifecycleState
					: session.sessionLifecycleState,
			parentId: updates.parentId !== undefined ? updates.parentId : session.parentId,
			prNumber: "prNumber" in updates ? updates.prNumber : session.prNumber,
			prState: "prState" in updates ? updates.prState : session.prState,
			prLinkMode: "prLinkMode" in updates ? updates.prLinkMode : session.prLinkMode,
			linkedPr: "linkedPr" in updates ? updates.linkedPr : session.linkedPr,
			worktreeDeleted:
				"worktreeDeleted" in updates ? updates.worktreeDeleted : session.worktreeDeleted,
			sequenceId: "sequenceId" in updates ? updates.sequenceId : session.sequenceId,
		}
	);
}

