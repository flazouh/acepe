import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as path from "node:path"

const require = createRequire(import.meta.url)
const pty = require("node-pty")

const chmodSpawnHelper = () => {
	const entry = require.resolve("node-pty")
	const packageRoot = path.resolve(path.dirname(entry), "..")
	const releaseHelper = path.join(packageRoot, "build", "Release", "spawn-helper")
	if (fs.existsSync(releaseHelper) === true) {
		fs.chmodSync(releaseHelper, 0o755)
	}
	const prebuilds = path.join(packageRoot, "prebuilds")
	if (fs.existsSync(prebuilds) === false) {
		return
	}
	for (const dir of fs.readdirSync(prebuilds)) {
		const helper = path.join(prebuilds, dir, "spawn-helper")
		if (fs.existsSync(helper) === true) {
			fs.chmodSync(helper, 0o755)
		}
	}
}

const send = (event) => {
	fs.writeSync(1, `${JSON.stringify(event)}\n`)
}

chmodSpawnHelper()

let proc = undefined
let buf = ""

const handleCommand = (command) => {
	if (command.op === "spawn") {
		if (proc !== undefined) {
			send({ op: "error", detail: "PTY already spawned" })
			return
		}
		try {
			if (fs.existsSync(command.shell) === false) {
				send({ op: "error", detail: `ENOENT: ${command.shell}` })
				process.exitCode = 1
				return
			}
			proc = pty.spawn(command.shell, command.args, {
				cwd: command.cwd,
				cols: command.cols,
				rows: command.rows,
				env: command.env,
				name: "xterm-256color"
			})
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "unknown failure"
			send({ op: "error", detail })
			process.exitCode = 1
			return
		}
		send({ op: "ready", pid: proc.pid })
		proc.onData((data) => {
			send({ op: "data", data })
		})
		proc.onExit((event) => {
			send({
				op: "exit",
				exitCode: event.exitCode,
				signal: event.signal === undefined || event.signal === 0 ? null : event.signal
			})
			process.exit(0)
		})
		return
	}
	if (proc === undefined) {
		send({ op: "error", detail: "PTY is not running" })
		return
	}
	if (command.op === "write") {
		proc.write(command.data)
		return
	}
	if (command.op === "resize") {
		proc.resize(command.cols, command.rows)
		return
	}
	if (command.signal === undefined) {
		proc.kill()
		return
	}
	proc.kill(command.signal)
}

if (process.argv[2] !== undefined) {
	handleCommand(JSON.parse(process.argv[2]))
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
	buf = `${buf}${chunk}`
	for (;;) {
		const index = buf.indexOf("\n")
		if (index < 0) {
			return
		}
		const line = buf.slice(0, index)
		buf = buf.slice(index + 1)
		if (line.length === 0) {
			continue
		}
		handleCommand(JSON.parse(line))
	}
})
