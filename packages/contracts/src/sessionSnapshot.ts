import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { type Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import type { OrchestrationEvent } from "./events.ts"
import type { SessionId } from "./ids.ts"
import {
	type RpcProjectedMessage,
	type RpcProjectedSession,
	type RpcSessionSnapshot,
} from "./rpc.ts"

const asTranscriptText = (value: string): typeof TrimmedNonEmptyString.Type =>
	Schema.decodeUnknownSync(TrimmedNonEmptyString)(value)

export const emptyRpcSessionSnapshot = (snapshotSequence: Sequence): RpcSessionSnapshot => ({
	snapshotSequence,
	session: null,
	messages: Arr.empty(),
	turns: Arr.empty(),
	activities: Arr.empty(),
	pendingApprovals: Arr.empty(),
})

const watermark = (snapshot: RpcSessionSnapshot, sequence: Sequence): Sequence =>
	sequence > snapshot.snapshotSequence ? sequence : snapshot.snapshotSequence

const withSequence = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
): RpcSessionSnapshot => ({
	snapshotSequence: watermark(snapshot, sequence),
	session: snapshot.session,
	messages: snapshot.messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
})

const isThisSession = (snapshot: RpcSessionSnapshot, sessionId: SessionId): boolean =>
	snapshot.session === null || snapshot.session.sessionId === sessionId

const replaceMessages = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
	messages: ReadonlyArray<RpcProjectedMessage>,
	session: RpcProjectedSession | null,
): RpcSessionSnapshot => ({
	snapshotSequence: watermark(snapshot, sequence),
	session,
	messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
})

const touchSession = (
	session: RpcProjectedSession | null,
	occurredAt: RpcProjectedSession["updatedAt"],
): RpcProjectedSession | null => {
	if (session === null) {
		return null
	}
	return {
		sessionId: session.sessionId,
		projectId: session.projectId,
		title: session.title,
		provider: session.provider,
		createdAt: session.createdAt,
		updatedAt: occurredAt,
		lastActivityAt: occurredAt,
		archivedAt: session.archivedAt,
		deletedAt: session.deletedAt,
		prNumber: session.prNumber,
		prLinkMode: session.prLinkMode,
	}
}

const upsertAssistant = (
	messages: ReadonlyArray<RpcProjectedMessage>,
	event: Extract<OrchestrationEvent, { readonly type: "TokenAppended" }>,
): ReadonlyArray<RpcProjectedMessage> => {
	const existing = Arr.findFirst(
		messages,
		(row) => row.rowType === "assistant" && row.messageId === event.payload.messageId,
	)
	if (Option.isNone(existing)) {
		const created: RpcProjectedMessage = {
			sessionId: event.payload.sessionId,
			sequence: event.sequence,
			messageId: event.payload.messageId,
			turnId: null,
			rowType: "assistant",
			content: {
				text: asTranscriptText(event.payload.token),
			},
		}
		return Arr.append(messages, created)
	}
	const current = existing.value
	if (current.rowType !== "assistant") {
		return messages
	}
	const updated: RpcProjectedMessage = {
		sessionId: current.sessionId,
		sequence: current.sequence,
		messageId: current.messageId,
		turnId: current.turnId,
		rowType: "assistant",
		content: {
			text: asTranscriptText(`${current.content.text}${event.payload.token}`),
		},
	}
	return Arr.map(messages, (row) =>
		row.rowType === "assistant" && row.messageId === event.payload.messageId ? updated : row,
	)
}

const appendUser = (
	messages: ReadonlyArray<RpcProjectedMessage>,
	event: Extract<OrchestrationEvent, { readonly type: "MessageSent" }>,
): ReadonlyArray<RpcProjectedMessage> => {
	const already = Arr.some(
		messages,
		(row) => row.rowType === "user" && row.messageId === event.payload.messageId,
	)
	if (already) {
		return messages
	}
	const created: RpcProjectedMessage = {
		sessionId: event.payload.sessionId,
		sequence: event.sequence,
		messageId: event.payload.messageId,
		turnId: null,
		rowType: "user",
		content: {
			text: event.payload.text,
		},
	}
	return Arr.append(messages, created)
}

const applySessionCreated = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "SessionCreated" }>,
): RpcSessionSnapshot => {
	if (snapshot.session !== null && snapshot.session.sessionId !== event.payload.sessionId) {
		return withSequence(snapshot, event.sequence)
	}
	const session: RpcProjectedSession = {
		sessionId: event.payload.sessionId,
		projectId: event.payload.projectId,
		title: event.payload.title,
		provider: null,
		createdAt: event.occurredAt,
		updatedAt: event.occurredAt,
		lastActivityAt: event.occurredAt,
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
	}
	return replaceMessages(snapshot, event.sequence, snapshot.messages, session)
}

const applySessionMetaUpdated = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "SessionMetaUpdated" }>,
): RpcSessionSnapshot => {
	if (!isThisSession(snapshot, event.payload.sessionId)) {
		return withSequence(snapshot, event.sequence)
	}
	if (snapshot.session === null) {
		return withSequence(snapshot, event.sequence)
	}
	const current = snapshot.session
	const session: RpcProjectedSession = {
		sessionId: current.sessionId,
		projectId: current.projectId,
		title: event.payload.title !== undefined ? event.payload.title : current.title,
		provider: current.provider,
		createdAt: current.createdAt,
		updatedAt: event.occurredAt,
		lastActivityAt: event.occurredAt,
		archivedAt: current.archivedAt,
		deletedAt: current.deletedAt,
		prNumber:
			event.payload.prNumber !== undefined ? event.payload.prNumber : current.prNumber,
		prLinkMode:
			event.payload.prLinkMode !== undefined ? event.payload.prLinkMode : current.prLinkMode,
	}
	return replaceMessages(snapshot, event.sequence, snapshot.messages, session)
}

export const applyEventToRpcSessionSnapshot = (
	snapshot: RpcSessionSnapshot,
	event: OrchestrationEvent,
): RpcSessionSnapshot => {
	if (event.sequence <= snapshot.snapshotSequence) {
		return snapshot
	}
	switch (event.type) {
		case "SessionCreated":
			return applySessionCreated(snapshot, event)
		case "SessionMetaUpdated":
			return applySessionMetaUpdated(snapshot, event)
		case "MessageSent": {
			if (!isThisSession(snapshot, event.payload.sessionId)) {
				return withSequence(snapshot, event.sequence)
			}
			return replaceMessages(
				snapshot,
				event.sequence,
				appendUser(snapshot.messages, event),
				touchSession(snapshot.session, event.occurredAt),
			)
		}
		case "TokenAppended": {
			if (!isThisSession(snapshot, event.payload.sessionId)) {
				return withSequence(snapshot, event.sequence)
			}
			return replaceMessages(
				snapshot,
				event.sequence,
				upsertAssistant(snapshot.messages, event),
				touchSession(snapshot.session, event.occurredAt),
			)
		}
		default:
			return withSequence(snapshot, event.sequence)
	}
}
