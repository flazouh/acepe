import { expect, test } from "bun:test"

import { SHELL_STARTUP_FAILED_PREFIX, ShellStartupError } from "./shell-startup-error.ts"

test("shell startup error message is greppable and carries the cause", () => {
	const error = new ShellStartupError({ reason: "rpc handlers rejected" })
	expect(error.message).toBe(`${SHELL_STARTUP_FAILED_PREFIX}: rpc handlers rejected`)
	expect(error._tag).toBe("ShellStartupError")
})
