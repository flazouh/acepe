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
	readonly readTextFile: (params: unknown) => unknown
	readonly writeTextFile: (params: unknown) => unknown
	readonly getDefaultShell: (params: unknown) => unknown
	readonly gitCall: (params: unknown) => unknown
	readonly agentCall: (params: unknown) => unknown
	readonly getProviderAccountUsage: (params: unknown) => unknown
	readonly listProviderSessions: (params: unknown) => unknown
	readonly listProviderProjects: (params: unknown) => unknown
	readonly importProviderSession: (params: unknown) => unknown
}

export type AcepeRpcWork = {
	readonly dispatch: (params: unknown) => unknown
	readonly snapshot: (params: unknown) => unknown
	readonly events: (params: unknown) => unknown
	readonly getProjectIndex: (params: unknown) => unknown
	readonly invalidateProjectIndex: (params: unknown) => unknown
	readonly readTextFile: (params: unknown) => unknown
	readonly writeTextFile: (params: unknown) => unknown
	readonly getDefaultShell: (params: unknown) => unknown
	readonly gitCall: (params: unknown) => unknown
	readonly agentCall: (params: unknown) => unknown
	readonly getProviderAccountUsage: (params: unknown) => unknown
	readonly listProviderSessions: (params: unknown) => unknown
	readonly listProviderProjects: (params: unknown) => unknown
	readonly importProviderSession: (params: unknown) => unknown
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
		invalidateProjectIndex: work.invalidateProjectIndex,
		readTextFile: work.readTextFile,
		writeTextFile: work.writeTextFile,
		getDefaultShell: work.getDefaultShell,
		gitCall: work.gitCall,
		agentCall: work.agentCall,
		getProviderAccountUsage: work.getProviderAccountUsage,
		listProviderSessions: work.listProviderSessions,
		listProviderProjects: work.listProviderProjects,
		importProviderSession: work.importProviderSession
	})
	return host.openWindow({
		title: acepeWindowSpec.title,
		url: acepeWindowSpec.url,
		frame: acepeWindowSpec.frame,
		titleBarStyle: acepeWindowSpec.titleBarStyle,
		activate: acepeWindowSpec.activate,
		hidden: acepeWindowSpec.hidden,
		preload: acepeWindowSpec.preload,
		rpc
	})
}
