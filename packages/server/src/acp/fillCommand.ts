import type { OrchestrationCommand } from "@acepe/contracts"
import * as Effect from "effect/Effect"

export const fillAcpCommand = Effect.fn("fillAcpCommand")(function*(
	command: OrchestrationCommand
) {
	return command
})
