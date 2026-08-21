import { launchAcepeShellWindow } from "@acepe/electrobun-shell";
import { makeAcepeLive } from "@acepe/server/bootstrap";
import {
	encodedDispatch,
	encodedGetProjectIndex,
	encodedInvalidateProjectIndex,
	encodedSnapshot,
	pushEvents,
} from "@acepe/server/rpc/encodedBoundary";
import * as Duration from "effect/Duration";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { BrowserView, BrowserWindow } from "electrobun/bun";

let emitEvents: (payload: unknown) => void = () => undefined;

const runtime = ManagedRuntime.make(
	makeAcepeLive({
		filename: "acepe-tracer.sqlite",
		tokenDelay: Duration.millis(40),
	}),
);

const launched = launchAcepeShellWindow(
	{
		defineRpc: (handlers) =>
			BrowserView.defineRPC({
				maxRequestTime: 5000,
				handlers: {
					requests: handlers,
					messages: {},
				},
			}),
		openWindow: (input) => {
			const win = new BrowserWindow({
				title: input.title,
				url: input.url,
				frame: input.frame,
				rpc: input.rpc,
			});
			emitEvents = (payload) => {
				win.webview.rpc.send.events(payload);
			};
			return input;
		},
	},
	{
		writeError: (line) => {
			process.stderr.write(`${line}\n`);
		},
		exit: (code) => process.exit(code),
	},
);

launched.attach({
		dispatch: (params) => runtime.runPromise(encodedDispatch(params)),
		snapshot: (params) => runtime.runPromise(encodedSnapshot(params)),
		getProjectIndex: (params) => runtime.runPromise(encodedGetProjectIndex(params)),
		invalidateProjectIndex: (params) => runtime.runPromise(encodedInvalidateProjectIndex(params)),
		events: (params) => {
			runtime.runFork(
				pushEvents(params, (payload) => {
					emitEvents(payload);
				}),
			);
			return undefined;
		},
	});
