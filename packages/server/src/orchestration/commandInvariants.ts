import type {
	CheckpointId,
	IsoDateTime,
	OrchestrationCommand,
	ProjectId,
	Sequence,
	SessionId,
	SkillsDiscoverCommand,
	VoiceLanguagesListCommand,
	VoiceModelsListCommand
} from "@acepe/contracts"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import { OrchestrationCommandInvariantError } from "./Errors.ts"

export type OrchestrationProject = {
	readonly id: ProjectId
}

export type OrchestrationCheckpoint = {
	readonly id: CheckpointId
}

export type OrchestrationSession = {
	readonly id: SessionId
	readonly projectId: ProjectId
	readonly archivedAt: IsoDateTime | null
	readonly checkpoints: ReadonlyArray<OrchestrationCheckpoint>
}

export type OrchestrationReadModel = {
	readonly snapshotSequence: Sequence
	readonly projects: ReadonlyArray<OrchestrationProject>
	readonly sessions: ReadonlyArray<OrchestrationSession>
}

export type ProjectInvariantInput = {
	readonly readModel: OrchestrationReadModel
	readonly command: OrchestrationCommand
	readonly projectId: ProjectId
}

export type SessionInvariantInput = {
	readonly readModel: OrchestrationReadModel
	readonly command: OrchestrationCommand
	readonly sessionId: SessionId
}

export type CheckpointInvariantInput = {
	readonly readModel: OrchestrationReadModel
	readonly command: OrchestrationCommand
	readonly sessionId: SessionId
	readonly checkpointId: CheckpointId
}

const findProjectById = (
	readModel: OrchestrationReadModel,
	projectId: ProjectId
): Option.Option<OrchestrationProject> =>
	Array.findFirst(readModel.projects, (project) => project.id === projectId)

const findSessionById = (
	readModel: OrchestrationReadModel,
	sessionId: SessionId
): Option.Option<OrchestrationSession> =>
	Array.findFirst(readModel.sessions, (session) => session.id === sessionId)

export const requireProject = Effect.fn("requireProject")(function*(input: ProjectInvariantInput) {
	const project = findProjectById(input.readModel, input.projectId)
	if (Option.isNone(project)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Project '${input.projectId}' does not exist for command '${input.command.type}'.`
		})
	}
	return project.value
})

export const requireProjectAbsent = Effect.fn("requireProjectAbsent")(function*(
	input: ProjectInvariantInput
) {
	const project = findProjectById(input.readModel, input.projectId)
	if (Option.isSome(project)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Project '${input.projectId}' already exists and cannot be created twice.`
		})
	}
})

export const requireSession = Effect.fn("requireSession")(function*(input: SessionInvariantInput) {
	const session = findSessionById(input.readModel, input.sessionId)
	if (Option.isNone(session)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Session '${input.sessionId}' does not exist for command '${input.command.type}'.`
		})
	}
	return session.value
})

export const requireSessionAbsent = Effect.fn("requireSessionAbsent")(function*(
	input: SessionInvariantInput
) {
	const session = findSessionById(input.readModel, input.sessionId)
	if (Option.isSome(session)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Session '${input.sessionId}' already exists and cannot be created twice.`
		})
	}
})

export const requireSessionNotArchived = Effect.fn("requireSessionNotArchived")(function*(
	input: SessionInvariantInput
) {
	const session = yield* requireSession(input)
	if (session.archivedAt !== null) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Session '${input.sessionId}' is already archived and cannot handle command '${input.command.type}'.`
		})
	}
	return session
})

export const requireSessionArchived = Effect.fn("requireSessionArchived")(function*(
	input: SessionInvariantInput
) {
	const session = yield* requireSession(input)
	if (session.archivedAt === null) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Session '${input.sessionId}' is not archived for command '${input.command.type}'.`
		})
	}
	return session
})

export const requireCheckpoint = Effect.fn("requireCheckpoint")(function*(
	input: CheckpointInvariantInput
) {
	const session = yield* requireSessionNotArchived(input)
	const checkpoint = Array.findFirst(
		session.checkpoints,
		(row) => row.id === input.checkpointId
	)
	if (Option.isNone(checkpoint)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Checkpoint '${input.checkpointId}' does not exist on session '${input.sessionId}' for command '${input.command.type}'.`
		})
	}
	return checkpoint.value
})

export const requireCheckpointAbsent = Effect.fn("requireCheckpointAbsent")(function*(
	input: CheckpointInvariantInput
) {
	const session = yield* requireSessionNotArchived(input)
	const checkpoint = Array.findFirst(
		session.checkpoints,
		(row) => row.id === input.checkpointId
	)
	if (Option.isSome(checkpoint)) {
		return yield* new OrchestrationCommandInvariantError({
			commandType: input.command.type,
			detail: `Checkpoint '${input.checkpointId}' already exists on session '${input.sessionId}' and cannot be created twice.`
		})
	}
	return session
})

export const requireUniqueSkillIds = Effect.fn("requireUniqueSkillIds")(function*(
	command: SkillsDiscoverCommand
) {
	const agentIds = Array.flatMap(command.catalog.agentSkills, (group) =>
		Array.map(group.skills, (skill) => skill.id)
	)
	const pluginIds = Array.map(command.catalog.pluginSkills, (skill) => skill.id)
	const ids = Array.appendAll(agentIds, pluginIds)
	let seen = HashSet.empty<string>()
	for (const id of ids) {
		if (HashSet.has(seen, id)) {
			return yield* new OrchestrationCommandInvariantError({
				commandType: command.type,
				detail: `Duplicate skill id '${id}' in skills.discover.`
			})
		}
		seen = HashSet.add(seen, id)
	}
})

export const requireUniqueVoiceModelIds = Effect.fn("requireUniqueVoiceModelIds")(function*(
	command: VoiceModelsListCommand
) {
	let seen = HashSet.empty<string>()
	for (const model of command.models) {
		if (HashSet.has(seen, model.id)) {
			return yield* new OrchestrationCommandInvariantError({
				commandType: command.type,
				detail: `Duplicate voice model id '${model.id}' in voice.models.list.`
			})
		}
		seen = HashSet.add(seen, model.id)
	}
})

export const requireUniqueVoiceLanguageCodes = Effect.fn("requireUniqueVoiceLanguageCodes")(
	function*(command: VoiceLanguagesListCommand) {
		let seen = HashSet.empty<string>()
		for (const language of command.languages) {
			if (HashSet.has(seen, language.code)) {
				return yield* new OrchestrationCommandInvariantError({
					commandType: command.type,
					detail: `Duplicate voice language code '${language.code}' in voice.languages.list.`
				})
			}
			seen = HashSet.add(seen, language.code)
		}
	}
)
