import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"

import {
	ActivityId,
	AgentsId,
	ApprovalRequestId,
	CheckpointId,
	CommandId,
	decodeActivityId,
	decodeAgentsId,
	decodeApprovalRequestId,
	decodeCheckpointId,
	decodeCommandId,
	decodeEventId,
	decodeMessageId,
	decodeProjectId,
	decodeProviderSessionId,
	decodeSessionId,
	decodeSettingsId,
	decodeSkillsId,
	decodeToolCallId,
	decodeTurnId,
	decodeVoiceId,
	EventId,
	MessageId,
	ProjectId,
	ProviderSessionId,
	SessionId,
	SettingsId,
	SkillsId,
	ToolCallId,
	TurnId,
	VoiceId,
} from "./ids.ts"

type IdDecoder = (input: unknown) => Effect.Effect<string, Schema.SchemaError>

type IdCase = {
	readonly name: string
	readonly make: (value: string) => string
	readonly decode: IdDecoder
}

const brandedIds: ReadonlyArray<IdCase> = [
	{ name: "ProjectId", make: ProjectId.make, decode: decodeProjectId },
	{ name: "SessionId", make: SessionId.make, decode: decodeSessionId },
	{ name: "TurnId", make: TurnId.make, decode: decodeTurnId },
	{ name: "MessageId", make: MessageId.make, decode: decodeMessageId },
	{ name: "ActivityId", make: ActivityId.make, decode: decodeActivityId },
	{ name: "ToolCallId", make: ToolCallId.make, decode: decodeToolCallId },
	{ name: "CheckpointId", make: CheckpointId.make, decode: decodeCheckpointId },
	{ name: "SettingsId", make: SettingsId.make, decode: decodeSettingsId },
	{ name: "SkillsId", make: SkillsId.make, decode: decodeSkillsId },
	{ name: "VoiceId", make: VoiceId.make, decode: decodeVoiceId },
	{ name: "AgentsId", make: AgentsId.make, decode: decodeAgentsId },
	{ name: "ApprovalRequestId", make: ApprovalRequestId.make, decode: decodeApprovalRequestId },
	{ name: "EventId", make: EventId.make, decode: decodeEventId },
	{ name: "CommandId", make: CommandId.make, decode: decodeCommandId },
	{ name: "ProviderSessionId", make: ProviderSessionId.make, decode: decodeProviderSessionId },
]

describe("branded ids", () => {
	for (const { decode, make, name } of brandedIds) {
		describe(name, () => {
			it("has a make constructor that brands a non-empty string", () => {
				expect(String(make(`${name}-1`))).toBe(`${name}-1`)
			})

			it("decodes a non-empty string", () => {
				const exit = Effect.runSyncExit(decode(`${name}-1`))
				expect(Exit.isSuccess(exit)).toBe(true)
				if (Exit.isSuccess(exit)) {
					expect(String(exit.value)).toBe(`${name}-1`)
				}
			})

			it("decodes a padded string by trimming", () => {
				const exit = Effect.runSyncExit(decode(`  ${name}-1  `))
				expect(Exit.isSuccess(exit)).toBe(true)
				if (Exit.isSuccess(exit)) {
					expect(String(exit.value)).toBe(`${name}-1`)
				}
			})

			it("rejects an empty string", () => {
				expect(Exit.isFailure(Effect.runSyncExit(decode("")))).toBe(true)
			})

			it("rejects a non-string", () => {
				expect(Exit.isFailure(Effect.runSyncExit(decode(1)))).toBe(true)
			})
		})
	}

	it("does not allow a ProjectId where a SessionId is required", () => {
		const projectId = ProjectId.make("project-1")
		// @ts-expect-error ProjectId is not assignable to SessionId
		const sessionId: typeof SessionId.Type = projectId
		expect(String(projectId)).toBe("project-1")
		expect(String(sessionId)).toBe("project-1")
	})

	it("does not allow a raw string as a ProjectId", () => {
		// @ts-expect-error raw string is not assignable to ProjectId
		const projectId: typeof ProjectId.Type = "project-1"
		expect(String(projectId)).toBe("project-1")
	})
})
