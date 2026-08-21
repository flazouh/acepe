import { pingRequestHandler, type PingResponse } from "./ping.ts"
import { type OpenedWindow } from "./start-shell.ts"
import { acepeWindowSpec } from "./window-spec.ts"

export type AcepeShellRpcHandlers = {
	readonly ping: (input: unknown) => PingResponse
	readonly dispatch: (params: unknown) => unknown
	readonly snapshot: (params: unknown) => unknown
	readonly events: (params: unknown) => unknown
	readonly getProjectIndex: (params: unknown) => unknown
	readonly invalidateProjectIndex: (params: unknown) => unknown
}

export type AcepeRpcWork = {
	readonly dispatch: (params: unknown) => unknown
	readonly snapshot: (params: unknown) => unknown
	readonly events: (params: unknown) => unknown
	readonly getProjectIndex: (params: unknown) => unknown
	readonly invalidateProjectIndex: (params: unknown) => unknown
}

export type AcepeShellHost<Rpc> = {
	readonly defineRpc: (handlers: AcepeShellRpcHandlers) => Rpc
	readonly openWindow: (input: OpenedWindow<Rpc>) => OpenedWindow<Rpc>
}

export const startAcepeShell = <Rpc>(
	host: AcepeShellHost<Rpc>,
	work: AcepeRpcWork
): OpenedWindow<Rpc> => {
	const rpc = host.defineRpc({
		ping: pingRequestHandler,
		dispatch: work.dispatch,
		snapshot: work.snapshot,
		events: work.events,
		getProjectIndex: work.getProjectIndex,
		invalidateProjectIndex: work.invalidateProjectIndex
	})
	return host.openWindow({
		title: acepeWindowSpec.title,
		url: acepeWindowSpec.url,
		frame: acepeWindowSpec.frame,
		activate: acepeWindowSpec.activate,
		hidden: acepeWindowSpec.hidden,
		preload: acepeWindowSpec.preload,
		rpc
	})
}
