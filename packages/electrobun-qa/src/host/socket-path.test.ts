import { describe, expect, it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import { DEFAULT_APP_ID, loadQaSocketPath, qaSocketPath } from "./socket-path.ts"

describe("socket-path", () => {
	it.effect("places the unix socket in the runtime dir", () =>
		Effect.sync(() => {
			expect(
				qaSocketPath({
					runtimeDir: "/tmp",
					appId: DEFAULT_APP_ID,
				}),
			).toBe("/tmp/electrobun-qa/com.acepe.app.sock")
		}),
	)

	it.effect("reads ELECTROBUN_QA_RUNTIME_DIR from config", () =>
		Effect.gen(function* () {
			const provider = ConfigProvider.fromEnv({
				env: {
					ELECTROBUN_QA_RUNTIME_DIR: "/var/run",
					ELECTROBUN_QA_APP_ID: "com.example.app",
				},
			})
			const path = yield* loadQaSocketPath().pipe(
				Effect.provideService(ConfigProvider.ConfigProvider, provider),
			)
			expect(path).toBe("/var/run/electrobun-qa/com.example.app.sock")
		}),
	)
})
