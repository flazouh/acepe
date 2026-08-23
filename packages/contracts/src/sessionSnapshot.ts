import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

import { type Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import type { OrchestrationEvent } from "./events.ts"
import {
	emptyGitFileReview,
	emptyProjectedGitReview,
	type GitFileReview,
	type GitHunkDecision,
	type ProjectedGitReview,
} from "./git.ts"
import type { SessionId } from "./ids.ts"
import {
	type RpcProjectedCheckpoint,
	type RpcProjectedMessage,
	type RpcProjectedSession,
	type RpcProjectedSetting,
	type RpcSessionSnapshot,
} from "./rpc.ts"
import { emptyProjectedVoice, type ProjectedVoice, type VoiceModelInfo } from "./voice.ts"

const asTranscriptText = (value: string): typeof TrimmedNonEmptyString.Type =>
	Schema.decodeUnknownSync(TrimmedNonEmptyString)(value)

export const emptyRpcSessionSnapshot = (snapshotSequence: Sequence): RpcSessionSnapshot => ({
	snapshotSequence,
	session: null,
	messages: Arr.empty(),
	turns: Arr.empty(),
	activities: Arr.empty(),
	pendingApprovals: Arr.empty(),
	checkpoints: Arr.empty(),
	projects: Arr.empty(),
	sessions: Arr.empty(),
	settings: Arr.empty(),
	skillsCatalog: null,
	voice: null,
	gitReview: null,
})

const watermark = (snapshot: RpcSessionSnapshot, sequence: Sequence): Sequence =>
	sequence > snapshot.snapshotSequence ? sequence : snapshot.snapshotSequence

const withSequence = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
): RpcSessionSnapshot => ({
	...snapshot,
	snapshotSequence: watermark(snapshot, sequence),
})

const isThisSession = (snapshot: RpcSessionSnapshot, sessionId: SessionId): boolean =>
	snapshot.session === null || snapshot.session.sessionId === sessionId

const replaceMessages = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
	messages: ReadonlyArray<RpcProjectedMessage>,
	session: RpcProjectedSession | null,
): RpcSessionSnapshot => ({
	...snapshot,
	snapshotSequence: watermark(snapshot, sequence),
	session,
	messages,
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

const settingKeyOrder = Order.mapInput(
	Str.Order,
	(row: RpcProjectedSetting) => row.key,
)

const applySettingsUpdated = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "SettingsUpdated" }>,
): RpcSessionSnapshot => {
	const next: RpcProjectedSetting = {
		key: event.payload.key,
		value: event.payload.value,
		sequence: event.sequence,
	}
	const without = Arr.filter(snapshot.settings, (row) => row.key !== next.key)
	return {
		snapshotSequence: watermark(snapshot, event.sequence),
		session: snapshot.session,
		messages: snapshot.messages,
		turns: snapshot.turns,
		activities: snapshot.activities,
		pendingApprovals: snapshot.pendingApprovals,
		projects: snapshot.projects,
		sessions: snapshot.sessions,
		settings: Arr.sort(Arr.append(without, next), settingKeyOrder),
		checkpoints: snapshot.checkpoints,
		skillsCatalog: snapshot.skillsCatalog,
		voice: snapshot.voice,
		gitReview: snapshot.gitReview,
	}
}

const MAX_RPC_SESSION_CHECKPOINTS = 500

const checkpointNumberOrder = Order.mapInput(
	Order.Number,
	(row: RpcProjectedCheckpoint) => row.checkpointNumber,
)

const retainNewestCheckpoints = (
	rows: ReadonlyArray<RpcProjectedCheckpoint>,
): ReadonlyArray<RpcProjectedCheckpoint> =>
	Arr.takeRight(Arr.sort(rows, checkpointNumberOrder), MAX_RPC_SESSION_CHECKPOINTS)

const replaceCheckpoints = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
	checkpoints: ReadonlyArray<RpcProjectedCheckpoint>,
): RpcSessionSnapshot => ({
	...snapshot,
	snapshotSequence: watermark(snapshot, sequence),
	checkpoints: retainNewestCheckpoints(checkpoints),
})

const applyCheckpointCreated = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointCreated" }>,
): RpcSessionSnapshot => {
	if (!isThisSession(snapshot, event.payload.sessionId)) {
		return withSequence(snapshot, event.sequence)
	}
	const next: RpcProjectedCheckpoint = {
		checkpointId: event.payload.checkpointId,
		sessionId: event.payload.sessionId,
		sequence: event.sequence,
		checkpointNumber: event.payload.checkpointNumber,
		name: event.payload.name,
		isAuto: event.payload.isAuto,
		toolCallId: event.payload.toolCallId,
		fileCount: event.payload.fileCount,
		status: "missing",
		createdAt: event.occurredAt,
		lastRevertedAt: null,
	}
	const without = Arr.filter(
		snapshot.checkpoints,
		(row) => row.checkpointId !== next.checkpointId,
	)
	return replaceCheckpoints(snapshot, event.sequence, Arr.append(without, next))
}

const applyCheckpointReadinessChanged = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointReadinessChanged" }>,
): RpcSessionSnapshot => {
	if (!isThisSession(snapshot, event.payload.sessionId)) {
		return withSequence(snapshot, event.sequence)
	}
	const checkpoints = Arr.map(snapshot.checkpoints, (row) => {
		if (row.checkpointId !== event.payload.checkpointId) {
			return row
		}
		return {
			checkpointId: row.checkpointId,
			sessionId: row.sessionId,
			sequence: event.sequence,
			checkpointNumber: row.checkpointNumber,
			name: row.name,
			isAuto: row.isAuto,
			toolCallId: row.toolCallId,
			fileCount: row.fileCount,
			status: event.payload.status,
			createdAt: row.createdAt,
			lastRevertedAt: row.lastRevertedAt,
		}
	})
	return replaceCheckpoints(snapshot, event.sequence, checkpoints)
}

const applyCheckpointReverted = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointReverted" }>,
): RpcSessionSnapshot => {
	if (!isThisSession(snapshot, event.payload.sessionId)) {
		return withSequence(snapshot, event.sequence)
	}
	const checkpoints = Arr.map(snapshot.checkpoints, (row) => {
		if (row.checkpointId !== event.payload.checkpointId) {
			return row
		}
		return {
			checkpointId: row.checkpointId,
			sessionId: row.sessionId,
			sequence: event.sequence,
			checkpointNumber: row.checkpointNumber,
			name: row.name,
			isAuto: row.isAuto,
			toolCallId: row.toolCallId,
			fileCount: row.fileCount,
			status: row.status,
			createdAt: row.createdAt,
			lastRevertedAt: event.occurredAt,
		}
	})
	return replaceCheckpoints(snapshot, event.sequence, checkpoints)
}

const applySkillsDiscovered = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "SkillsDiscovered" }>,
): RpcSessionSnapshot => ({
	snapshotSequence: watermark(snapshot, event.sequence),
	session: snapshot.session,
	messages: snapshot.messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
	projects: snapshot.projects,
	sessions: snapshot.sessions,
	settings: snapshot.settings,
	checkpoints: snapshot.checkpoints,
	skillsCatalog: {
		sequence: event.sequence,
		agents: event.payload.agents,
		agentSkills: event.payload.agentSkills,
		plugins: event.payload.plugins,
		pluginSkills: event.payload.pluginSkills,
		tree: event.payload.tree,
	},
	voice: snapshot.voice,
	gitReview: snapshot.gitReview,
})

const upsertVoiceModel = (
	models: ReadonlyArray<VoiceModelInfo>,
	next: VoiceModelInfo,
): ReadonlyArray<VoiceModelInfo> => {
	const existing = Arr.findFirst(models, (row) => row.id === next.id)
	if (Option.isNone(existing)) {
		return Arr.append(models, next)
	}
	return Arr.map(models, (row) => (row.id === next.id ? next : row))
}

const markModelDeleted = (
	models: ReadonlyArray<VoiceModelInfo>,
	modelId: string,
): ReadonlyArray<VoiceModelInfo> =>
	Arr.map(models, (row) => {
		if (row.id !== modelId) {
			return row
		}
		return {
			id: row.id,
			name: row.name,
			sizeBytes: row.sizeBytes,
			isEnglishOnly: row.isEnglishOnly,
			isDownloaded: false,
			isLoaded: false,
			downloadUrl: row.downloadUrl,
		}
	})

const markModelDownloaded = (
	models: ReadonlyArray<VoiceModelInfo>,
	modelId: string,
): ReadonlyArray<VoiceModelInfo> =>
	Arr.map(models, (row) => {
		if (row.id !== modelId) {
			return row
		}
		return {
			id: row.id,
			name: row.name,
			sizeBytes: row.sizeBytes,
			isEnglishOnly: row.isEnglishOnly,
			isDownloaded: true,
			isLoaded: row.isLoaded,
			downloadUrl: row.downloadUrl,
		}
	})

const currentVoice = (snapshot: RpcSessionSnapshot, sequence: Sequence): ProjectedVoice => {
	if (snapshot.voice === null) {
		return emptyProjectedVoice(sequence)
	}
	return snapshot.voice
}

const replaceVoice = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
	voice: ProjectedVoice,
): RpcSessionSnapshot => ({
	snapshotSequence: watermark(snapshot, sequence),
	session: snapshot.session,
	messages: snapshot.messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
	projects: snapshot.projects,
	sessions: snapshot.sessions,
	settings: snapshot.settings,
	checkpoints: snapshot.checkpoints,
	skillsCatalog: snapshot.skillsCatalog,
	voice: {
		sequence,
		models: voice.models,
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	},
	gitReview: snapshot.gitReview,
})

const applyVoiceModelsListed = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelsListed" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: event.payload.models,
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceLanguagesListed = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceLanguagesListed" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: voice.models,
		languages: event.payload.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceModelStatusReported = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelStatusReported" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: upsertVoiceModel(voice.models, event.payload.model),
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceModelDownloaded = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelDownloaded" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: markModelDownloaded(voice.models, event.payload.modelId),
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceModelDeleted = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelDeleted" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: markModelDeleted(voice.models, event.payload.modelId),
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceModelLoaded = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceModelLoaded" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: upsertVoiceModel(voice.models, event.payload.model),
		languages: voice.languages,
		recording: voice.recording,
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceRecordingStarted = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingStarted" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: voice.models,
		languages: voice.languages,
		recording: {
			sessionId: event.payload.sessionId,
			phase: "recording",
		},
		lastTranscription: voice.lastTranscription,
	})
}

const applyVoiceRecordingStopped = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingStopped" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: voice.models,
		languages: voice.languages,
		recording: null,
		lastTranscription: {
			sessionId: event.payload.sessionId,
			text: event.payload.result.text,
			language: event.payload.result.language,
			durationMs: event.payload.result.durationMs,
		},
	})
}

const applyVoiceRecordingCancelled = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "VoiceRecordingCancelled" }>,
): RpcSessionSnapshot => {
	const voice = currentVoice(snapshot, event.sequence)
	return replaceVoice(snapshot, event.sequence, {
		sequence: event.sequence,
		models: voice.models,
		languages: voice.languages,
		recording: null,
		lastTranscription: voice.lastTranscription,
	})
}

const currentGitReview = (
	snapshot: RpcSessionSnapshot,
	projectId: ProjectedGitReview["projectId"],
	sequence: Sequence,
): ProjectedGitReview => {
	if (snapshot.gitReview === null || snapshot.gitReview.projectId !== projectId) {
		return emptyProjectedGitReview(projectId, sequence)
	}
	return snapshot.gitReview
}

const replaceGitReview = (
	snapshot: RpcSessionSnapshot,
	sequence: Sequence,
	gitReview: ProjectedGitReview,
): RpcSessionSnapshot => ({
	snapshotSequence: watermark(snapshot, sequence),
	session: snapshot.session,
	messages: snapshot.messages,
	turns: snapshot.turns,
	activities: snapshot.activities,
	pendingApprovals: snapshot.pendingApprovals,
	projects: snapshot.projects,
	sessions: snapshot.sessions,
	settings: snapshot.settings,
	checkpoints: snapshot.checkpoints,
	skillsCatalog: snapshot.skillsCatalog,
	voice: snapshot.voice,
	gitReview: {
		sequence,
		projectId: gitReview.projectId,
		status: gitReview.status,
		files: gitReview.files,
	},
})

const upsertGitFile = (
	files: ReadonlyArray<GitFileReview>,
	path: GitFileReview["path"],
	update: (current: GitFileReview) => GitFileReview,
): ReadonlyArray<GitFileReview> => {
	const existing = Arr.findFirst(files, (file) => file.path === path)
	const next = update(Option.getOrElse(existing, () => emptyGitFileReview(path)))
	if (Option.isNone(existing)) {
		return Arr.append(files, next)
	}
	return Arr.map(files, (file) => (file.path === path ? next : file))
}

const upsertHunkDecision = (
	decisions: ReadonlyArray<GitHunkDecision>,
	next: GitHunkDecision,
): ReadonlyArray<GitHunkDecision> => {
	const existing = Arr.findFirst(decisions, (row) => row.hunkIndex === next.hunkIndex)
	if (Option.isNone(existing)) {
		return Arr.append(decisions, next)
	}
	return Arr.map(decisions, (row) => (row.hunkIndex === next.hunkIndex ? next : row))
}

const applyGitStatusRefreshed = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "GitStatusRefreshed" }>,
): RpcSessionSnapshot => {
	const review = currentGitReview(snapshot, event.payload.projectId, event.sequence)
	return replaceGitReview(snapshot, event.sequence, {
		sequence: event.sequence,
		projectId: event.payload.projectId,
		status: event.payload.status,
		files: review.files,
	})
}

const applyGitDiffLoaded = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "GitDiffLoaded" }>,
): RpcSessionSnapshot => {
	const review = currentGitReview(snapshot, event.payload.projectId, event.sequence)
	return replaceGitReview(snapshot, event.sequence, {
		sequence: event.sequence,
		projectId: event.payload.projectId,
		status: review.status,
		files: upsertGitFile(review.files, event.payload.filePath, (file) => ({
			path: file.path,
			diff: event.payload.diff,
			patch: event.payload.patch,
			blame: file.blame,
			hunkDecisions: file.hunkDecisions,
		})),
	})
}

const applyGitBlameLoaded = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "GitBlameLoaded" }>,
): RpcSessionSnapshot => {
	const review = currentGitReview(snapshot, event.payload.projectId, event.sequence)
	return replaceGitReview(snapshot, event.sequence, {
		sequence: event.sequence,
		projectId: event.payload.projectId,
		status: review.status,
		files: upsertGitFile(review.files, event.payload.filePath, (file) => ({
			path: file.path,
			diff: file.diff,
			patch: file.patch,
			blame: event.payload.blame,
			hunkDecisions: file.hunkDecisions,
		})),
	})
}

const applyGitHunkAccepted = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "GitHunkAccepted" }>,
): RpcSessionSnapshot => {
	const review = currentGitReview(snapshot, event.payload.projectId, event.sequence)
	return replaceGitReview(snapshot, event.sequence, {
		sequence: event.sequence,
		projectId: event.payload.projectId,
		status: review.status,
		files: upsertGitFile(review.files, event.payload.filePath, (file) => ({
			path: file.path,
			diff: file.diff,
			patch: file.patch,
			blame: file.blame,
			hunkDecisions: upsertHunkDecision(file.hunkDecisions, {
				hunkIndex: event.payload.hunkIndex,
				action: "accepted",
			}),
		})),
	})
}

const applyGitHunkRejected = (
	snapshot: RpcSessionSnapshot,
	event: Extract<OrchestrationEvent, { readonly type: "GitHunkRejected" }>,
): RpcSessionSnapshot => {
	const review = currentGitReview(snapshot, event.payload.projectId, event.sequence)
	return replaceGitReview(snapshot, event.sequence, {
		sequence: event.sequence,
		projectId: event.payload.projectId,
		status: review.status,
		files: upsertGitFile(review.files, event.payload.filePath, (file) => ({
			path: file.path,
			diff:
				file.diff === null
					? null
					: {
							oldContent: file.diff.oldContent,
							newContent: event.payload.newContent,
							fileName: file.diff.fileName,
						},
			patch: file.patch,
			blame: file.blame,
			hunkDecisions: upsertHunkDecision(file.hunkDecisions, {
				hunkIndex: event.payload.hunkIndex,
				action: "rejected",
			}),
		})),
	})
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
		case "SettingsUpdated":
			return applySettingsUpdated(snapshot, event)
		case "CheckpointCreated":
			return applyCheckpointCreated(snapshot, event)
		case "CheckpointReadinessChanged":
			return applyCheckpointReadinessChanged(snapshot, event)
		case "CheckpointReverted":
			return applyCheckpointReverted(snapshot, event)

		case "SkillsDiscovered":
			return applySkillsDiscovered(snapshot, event)
		case "VoiceModelsListed":
			return applyVoiceModelsListed(snapshot, event)
		case "VoiceLanguagesListed":
			return applyVoiceLanguagesListed(snapshot, event)
		case "VoiceModelStatusReported":
			return applyVoiceModelStatusReported(snapshot, event)
		case "VoiceModelDownloaded":
			return applyVoiceModelDownloaded(snapshot, event)
		case "VoiceModelDeleted":
			return applyVoiceModelDeleted(snapshot, event)
		case "VoiceModelLoaded":
			return applyVoiceModelLoaded(snapshot, event)
		case "VoiceRecordingStarted":
			return applyVoiceRecordingStarted(snapshot, event)
		case "VoiceRecordingStopped":
			return applyVoiceRecordingStopped(snapshot, event)
		case "VoiceRecordingCancelled":
			return applyVoiceRecordingCancelled(snapshot, event)
		case "GitStatusRefreshed":
			return applyGitStatusRefreshed(snapshot, event)
		case "GitDiffLoaded":
			return applyGitDiffLoaded(snapshot, event)
		case "GitBlameLoaded":
			return applyGitBlameLoaded(snapshot, event)
		case "GitHunkAccepted":
			return applyGitHunkAccepted(snapshot, event)
		case "GitHunkRejected":
			return applyGitHunkRejected(snapshot, event)
		case "ToolCallObserved": {
			if (!isThisSession(snapshot, event.payload.sessionId)) {
				return withSequence(snapshot, event.sequence)
			}
			const nextActivity = {
				activityId: event.payload.activityId,
				sessionId: event.payload.sessionId,
				sequence: event.sequence,
				kind: "tool",
				status: event.payload.status,
				title: event.payload.title,
				path: event.payload.path,
				toolCallId: event.payload.toolCallId,
			}
			const without = Arr.filter(
				snapshot.activities,
				(row) => row.activityId !== event.payload.activityId,
			)
			return {
				...withSequence(snapshot, event.sequence),
				session: touchSession(snapshot.session, event.occurredAt),
				activities: Arr.append(without, nextActivity),
			}
		}
		case "ApprovalRequested": {
			if (!isThisSession(snapshot, event.payload.sessionId)) {
				return withSequence(snapshot, event.sequence)
			}
			const nextApproval = {
				approvalRequestId: event.payload.approvalRequestId,
				sessionId: event.payload.sessionId,
				sequence: event.sequence,
				title: event.payload.title,
			}
			const without = Arr.filter(
				snapshot.pendingApprovals,
				(row) => row.approvalRequestId !== event.payload.approvalRequestId,
			)
			return {
				...withSequence(snapshot, event.sequence),
				session: touchSession(snapshot.session, event.occurredAt),
				pendingApprovals: Arr.append(without, nextApproval),
			}
		}
		case "InteractionReplied": {
			if (!isThisSession(snapshot, event.payload.sessionId)) {
				return withSequence(snapshot, event.sequence)
			}
			return {
				...withSequence(snapshot, event.sequence),
				session: touchSession(snapshot.session, event.occurredAt),
				pendingApprovals: Arr.filter(
					snapshot.pendingApprovals,
					(row) => row.approvalRequestId !== event.payload.approvalRequestId,
				),
			}
		}
		default:
			return withSequence(snapshot, event.sequence)
	}
}
