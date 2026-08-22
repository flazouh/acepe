import type { IsoDateTime, OrchestrationCommand, ProjectId, Sequence, SessionId, SkillsDiscoverCommand } from "@acepe/contracts"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import { OrchestrationCommandInvariantError } from "./Errors.ts"

export type OrchestrationProject = {
	readonly id: ProjectId
}

export type OrchestrationSession = {
	readonly id: SessionId
	readonly projectId: ProjectId
	readonly archivedAt: IsoDateTime | null
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
