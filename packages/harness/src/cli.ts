import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import { parseRecordArgs, runRecordHarness } from "./record.ts"

export { parseRecordArgs, runRecordHarness }

const importMeta = import.meta as ImportMeta & { readonly main?: boolean }
if (importMeta.main === true) {
	BunRuntime.runMain(
		runRecordHarness().pipe(
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(BunServices.layer),
		),
	)
}
