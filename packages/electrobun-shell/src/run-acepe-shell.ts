import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import { type AcepeRpcWork, type AcepeShellHost, startAcepeShell } from "./start-acepe-shell.ts"
import { type OpenedWindow } from "./start-shell.ts"
import { SHELL_STARTUP_FAILED_PREFIX, ShellStartupError } from "./shell-startup-error.ts"

export type ShellIo = {
	readonly writeError: (line: string) => void
	readonly exit: (code: number) => never
}

export type LaunchedAcepeShell<Rpc> = {
	readonly opened: OpenedWindow<Rpc>
	readonly attach: (work: AcepeRpcWork) => void
}

const RPC_WORK_NOT_ATTACHED = "rpc work is not attached"

const formatUnknown = (cause: unknown): string => {
	if (Predicate.isError(cause) === true) {
		return cause.message
	}
	if (Predicate.isString(cause) === true) {
		return cause
	}
	return "unknown shell startup failure"
}

const toStartupError = (cause: unknown): ShellStartupError => {
	if (Schema.is(ShellStartupError)(cause) === true) {
		return cause
	}
	return new ShellStartupError({ reason: formatUnknown(cause) })
}

const requireAttached = (live: AcepeRpcWork | null): AcepeRpcWork => {
	if (live === null) {
		throw new ShellStartupError({ reason: RPC_WORK_NOT_ATTACHED })
	}
	return live
}

export const makeDeferredRpcWork = (): {
	readonly work: AcepeRpcWork
	readonly attach: (live: AcepeRpcWork) => void
} => {
	let live: AcepeRpcWork | null = null
	return {
		work: {
			dispatch: (params) => requireAttached(live).dispatch(params),
			snapshot: (params) => requireAttached(live).snapshot(params),
			events: (params) => requireAttached(live).events(params),
			getProjectIndex: (params) => requireAttached(live).getProjectIndex(params),
			invalidateProjectIndex: (params) =>
				requireAttached(live).invalidateProjectIndex(params),
		},
		attach: (next) => {
			live = next
		},
	}
}

const failLoud = (io: ShellIo, cause: Cause.Cause<ShellStartupError>): never => {
	io.writeError(`${SHELL_STARTUP_FAILED_PREFIX}: ${Cause.pretty(cause)}`)
	return io.exit(1)
}

export const launchAcepeShellWindow = <Rpc>(
	host: AcepeShellHost<Rpc>,
	io: ShellIo,
): LaunchedAcepeShell<Rpc> => {
	const deferred = makeDeferredRpcWork()
	const started = Effect.runSyncExit(
		Effect.try({
			try: () => startAcepeShell(host, deferred.work),
			catch: toStartupError,
		}),
	)
	if (Exit.isFailure(started)) {
		return failLoud(io, started.cause)
	}
	return {
		opened: started.value,
		attach: deferred.attach,
	}
}
