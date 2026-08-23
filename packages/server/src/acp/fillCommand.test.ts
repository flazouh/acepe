import { CommandId, SessionResumeCommand, SessionId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { fillAcpCommand } from "./fillCommand.ts"

Vitest.describe("fillAcpCommand", () => {
	Vitest.it.effect("passes session.resume through unchanged", () =>
		Effect.gen(function*() {
			const command = SessionResumeCommand.make({
				type: "session.resume",
				commandId: CommandId.make("cmd-1"),
				sessionId: SessionId.make("session-1")
			})
			const filled = yield* fillAcpCommand(command)
			Vitest.expect(filled).toEqual(command)
		})
	)
})
