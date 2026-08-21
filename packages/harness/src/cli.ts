import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stdio from "effect/Stdio"
import { parseRecordArgs, runRecordHarness } from "./record.ts"
import { parseReplayArgs, runReplayHarness } from "./replay.ts"

export { parseRecordArgs, runRecordHarness }
export { parseReplayArgs, runReplayHarness }

export const runHarness = Effect.fn("runHarness")(function* () {
	const stdio = yield* Stdio.Stdio
	const args = yield* stdio.args
	const command = Option.getOrUndefined(Arr.head(args))
	if (command === "replay") {
		return yield* runReplayHarness()
	}
	return yield* runRecordHarness()
})

const importMeta = import.meta as ImportMeta & { readonly main?: boolean }
if (importMeta.main === true) {
	BunRuntime.runMain(
		runHarness().pipe(
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(BunServices.layer),
		),
	)
}
