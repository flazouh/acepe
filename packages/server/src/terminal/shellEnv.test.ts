import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import {
	buildTerminalEnv,
	commandSpawnTarget,
	defaultCaptureShell,
	defaultShell,
	DEFAULT_CAPTURE_SHELL,
	DEFAULT_TERM,
	DEFAULT_UNIX_SHELL,
	DEFAULT_WINDOWS_SHELL,
	enforceOutputLimit,
	interactiveSpawnTarget,
	isWindowsHost,
	isZshShellName,
	parseEnvOutput,
	SHELL_ENV_CAPTURE_COMMAND,
	shellCaptureArgs,
	shellEnvPayload
} from "./shellEnv.ts"

Vitest.describe("parseEnvOutput", () => {
	Vitest.it("parses NUL-delimited env entries including values with newlines", () => {
		const parsed = parseEnvOutput("AZURE_API_KEY=secret\0HOME=/Users/test\0MULTI=line1\nline2\0")
		Vitest.assert.strictEqual(Rec.get(parsed, "AZURE_API_KEY").pipe(Option.getOrUndefined), "secret")
		Vitest.assert.strictEqual(Rec.get(parsed, "HOME").pipe(Option.getOrUndefined), "/Users/test")
		Vitest.assert.strictEqual(Rec.get(parsed, "MULTI").pipe(Option.getOrUndefined), "line1\nline2")
	})

	Vitest.it("rejects malformed entries", () => {
		const parsed = parseEnvOutput("VALID=yes\0not-a-var\0=no_key\0ALSO_VALID=ok\0")
		Vitest.assert.strictEqual(Rec.size(parsed), 2)
		Vitest.assert.strictEqual(Rec.get(parsed, "VALID").pipe(Option.getOrUndefined), "yes")
		Vitest.assert.strictEqual(Rec.get(parsed, "ALSO_VALID").pipe(Option.getOrUndefined), "ok")
	})

	Vitest.it("keeps values that contain equals signs", () => {
		const parsed = parseEnvOutput("CONNECTION=host=localhost;port=5432\0")
		Vitest.assert.strictEqual(
			Rec.get(parsed, "CONNECTION").pipe(Option.getOrUndefined),
			"host=localhost;port=5432"
		)
	})
})

Vitest.describe("shellEnvPayload", () => {
	Vitest.it("discards shell noise before the capture marker", () => {
		const parsed = parseEnvOutput(
			shellEnvPayload("loading plugin...\n__ACEPE_ENV_START__\0AZURE_API_KEY=secret\0")
		)
		Vitest.assert.strictEqual(Rec.get(parsed, "AZURE_API_KEY").pipe(Option.getOrUndefined), "secret")
	})
})

Vitest.describe("shellCaptureArgs", () => {
	Vitest.it("uses an interactive login shell for zsh so ~/.zshrc is read", () => {
		Vitest.assert.deepStrictEqual(shellCaptureArgs("/bin/zsh"), ["-ilc", SHELL_ENV_CAPTURE_COMMAND])
		Vitest.assert.deepStrictEqual(shellCaptureArgs("/opt/homebrew/bin/zsh"), [
			"-ilc",
			SHELL_ENV_CAPTURE_COMMAND
		])
		Vitest.assert.strictEqual(isZshShellName("zsh"), true)
		Vitest.assert.strictEqual(isZshShellName("Zsh"), true)
		Vitest.assert.deepStrictEqual(shellCaptureArgs("/bin/bash"), ["-lc", SHELL_ENV_CAPTURE_COMMAND])
	})
})

Vitest.describe("defaultShell", () => {
	Vitest.it("prefers COMSPEC on Windows and SHELL on Unix", () => {
		Vitest.assert.strictEqual(
			defaultShell(Option.some("C:\\Windows\\system32\\cmd.exe"), Option.some("/bin/zsh")),
			"C:\\Windows\\system32\\cmd.exe"
		)
		Vitest.assert.strictEqual(defaultShell(Option.none(), Option.some("/bin/zsh")), "/bin/zsh")
		Vitest.assert.strictEqual(defaultShell(Option.none(), Option.none()), DEFAULT_UNIX_SHELL)
		Vitest.assert.strictEqual(isWindowsHost(Option.some("cmd.exe")), true)
		Vitest.assert.strictEqual(isWindowsHost(Option.none()), false)
		Vitest.assert.strictEqual(defaultCaptureShell(Option.some("/bin/bash")), "/bin/bash")
		Vitest.assert.strictEqual(defaultCaptureShell(Option.none()), DEFAULT_CAPTURE_SHELL)
	})
})

Vitest.describe("spawn targets", () => {
	Vitest.it("wraps a command in the platform shell", () => {
		Vitest.assert.deepStrictEqual(commandSpawnTarget(false, "echo hello"), {
			file: DEFAULT_UNIX_SHELL,
			args: ["-c", "echo hello"]
		})
		Vitest.assert.deepStrictEqual(commandSpawnTarget(true, "echo hello"), {
			file: DEFAULT_WINDOWS_SHELL,
			args: ["/C", "echo hello"]
		})
		Vitest.assert.deepStrictEqual(interactiveSpawnTarget("/bin/zsh"), {
			file: "/bin/zsh",
			args: []
		})
	})
})

Vitest.describe("buildTerminalEnv", () => {
	Vitest.it("fills PATH and TERM from fallbacks then overlays request env", () => {
		const env = buildTerminalEnv({
			loginEnv: Rec.fromEntries([["HOME", "/Users/test"]]),
			requestEnv: [{ name: "FOO", value: "bar" }],
			pathFallback: "/usr/bin",
			term: DEFAULT_TERM
		})
		Vitest.assert.strictEqual(Rec.get(env, "HOME").pipe(Option.getOrUndefined), "/Users/test")
		Vitest.assert.strictEqual(Rec.get(env, "PATH").pipe(Option.getOrUndefined), "/usr/bin")
		Vitest.assert.strictEqual(Rec.get(env, "TERM").pipe(Option.getOrUndefined), DEFAULT_TERM)
		Vitest.assert.strictEqual(Rec.get(env, "FOO").pipe(Option.getOrUndefined), "bar")
	})

	Vitest.it("lets request env override login PATH", () => {
		const env = buildTerminalEnv({
			loginEnv: Rec.fromEntries([
				["PATH", "/opt/homebrew/bin:/usr/bin"],
				["TERM", "dumb"]
			]),
			requestEnv: [{ name: "PATH", value: "/custom" }],
			pathFallback: "/usr/bin",
			term: DEFAULT_TERM
		})
		Vitest.assert.strictEqual(Rec.get(env, "PATH").pipe(Option.getOrUndefined), "/custom")
		Vitest.assert.strictEqual(Rec.get(env, "TERM").pipe(Option.getOrUndefined), "dumb")
	})
})

Vitest.describe("enforceOutputLimit", () => {
	Vitest.it("keeps the tail when the buffer exceeds the limit", () => {
		const limited = enforceOutputLimit("abcdefghij", 4)
		Vitest.assert.deepStrictEqual(limited, { text: "ghij", truncated: true })
		Vitest.assert.deepStrictEqual(enforceOutputLimit("abc", 8), { text: "abc", truncated: false })
	})
})
