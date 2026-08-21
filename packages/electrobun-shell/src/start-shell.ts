import { pingRequestHandler, type PingResponse } from "./ping.ts"
import { acepeWindowSpec, type AcepeWindowSpec } from "./window-spec.ts"

export type ShellRpcHandlers = {
	readonly ping: (input: unknown) => PingResponse
}

export type OpenedWindow<Rpc> = AcepeWindowSpec & {
	readonly rpc: Rpc
}

export type ShellHost<Rpc> = {
	readonly defineRpc: (handlers: ShellRpcHandlers) => Rpc
	readonly openWindow: (input: OpenedWindow<Rpc>) => OpenedWindow<Rpc>
}

export const startShell = <Rpc>(host: ShellHost<Rpc>): OpenedWindow<Rpc> => {
	const rpc = host.defineRpc({
		ping: pingRequestHandler,
	})
	return host.openWindow({
		title: acepeWindowSpec.title,
		url: acepeWindowSpec.url,
		frame: acepeWindowSpec.frame,
		activate: acepeWindowSpec.activate,
		hidden: acepeWindowSpec.hidden,
		preload: acepeWindowSpec.preload,
		rpc,
	})
}
