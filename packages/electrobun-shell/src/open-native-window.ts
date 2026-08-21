import { formatRpcRoundtripLine, formatWindowOpenedLine } from "./ping.ts"
import { type AcepeShellRpcHandlers } from "./start-acepe-shell.ts"
import { launchAcepeShellWindow, type LaunchedAcepeShell, type ShellIo } from "./run-acepe-shell.ts"
import { ShellStartupError } from "./shell-startup-error.ts"
import { type OpenedWindow } from "./start-shell.ts"
import { type WindowFrame } from "./window-spec.ts"

export type ElectrobunWindowOptions<Rpc> = {
	readonly title: string
	readonly url: string
	readonly frame: WindowFrame
	readonly activate: boolean
	readonly hidden: boolean
	readonly rpc: Rpc
	// Injected by electrobun-qa when the QA surface is enabled. Null in signed
	// builds, where the preload and host are dropped entirely.
	readonly preload: string | null
}

export type ElectrobunWindowHandle = {
	readonly ptr: unknown
	readonly id: number
	readonly webview: {
		readonly rpc: {
			readonly send: {
				readonly events: (payload: unknown) => void
			}
		}
		readonly executeJavascript: (js: string) => void
	}
	readonly show: () => void
	readonly activate: () => void
}

export const electrobunWindowOptions = <Rpc>(
	input: OpenedWindow<Rpc>,
): ElectrobunWindowOptions<Rpc> => ({
	title: input.title,
	url: input.url,
	frame: input.frame,
	activate: input.activate,
	hidden: input.hidden,
	rpc: input.rpc,
	preload: input.preload,
})

export const realizeAcepeNativeWindow = (
	created: {
		readonly ptr: unknown
		readonly id: number
		readonly show: () => void
		readonly activate: () => void
	},
	spec: { readonly hidden: boolean },
): void => {
	if (created.ptr === null || created.ptr === undefined || created.ptr === 0) {
		throw new ShellStartupError({
			reason: "BrowserWindow returned without a native pointer",
		})
	}
	if (spec.hidden === false) {
		created.show()
		created.activate()
	}
}

export type ElectrobunBunBindings<Rpc> = {
	readonly defineRPC: (input: {
		readonly maxRequestTime: number
		readonly handlers: {
			readonly requests: AcepeShellRpcHandlers
			readonly messages: Record<string, never>
		}
	}) => Rpc
	readonly BrowserWindow: new (options: ElectrobunWindowOptions<Rpc>) => ElectrobunWindowHandle
	readonly setDockIconVisible: (visible: boolean) => void
}

export type LaunchedElectrobunAcepe<Rpc> = LaunchedAcepeShell<Rpc> & {
	readonly sendEvents: (payload: unknown) => void
	readonly executeJavascript: (js: string) => void
}

export const startElectrobunAcepeApp = <Rpc>(
	bindings: ElectrobunBunBindings<Rpc>,
	io: ShellIo,
): LaunchedElectrobunAcepe<Rpc> => {
	let sendEvents: (payload: unknown) => void = () => undefined
	let executeJavascript: (js: string) => void = () => undefined
	const launched = launchAcepeShellWindow(
		{
			defineRpc: (handlers) =>
				bindings.defineRPC({
					maxRequestTime: 5000,
					handlers: {
						requests: {
							ping: (input) => {
								const response = handlers.ping(input)
								io.writeError(formatRpcRoundtripLine(response.echo))
								return response
							},
							dispatch: handlers.dispatch,
							snapshot: handlers.snapshot,
							events: handlers.events,
							getProjectIndex: handlers.getProjectIndex,
							invalidateProjectIndex: handlers.invalidateProjectIndex,
						},
						messages: {},
					},
				}),
			openWindow: (input) => {
				const win = new bindings.BrowserWindow(electrobunWindowOptions(input))
				realizeAcepeNativeWindow(win, input)
				bindings.setDockIconVisible(true)
				io.writeError(formatWindowOpenedLine(input.title))
				sendEvents = (payload) => {
					win.webview.rpc.send.events(payload)
				}
				executeJavascript = (js) => {
					win.webview.executeJavascript(js)
				}
				return input
			},
		},
		io,
	)
	return {
		opened: launched.opened,
		attach: launched.attach,
		sendEvents: (payload) => {
			sendEvents(payload)
		},
		executeJavascript: (js) => {
			executeJavascript(js)
		},
	}
}

