import { startShell } from "@acepe/electrobun-shell";
import { BrowserView, BrowserWindow } from "electrobun/bun";

startShell({
	defineRpc: (handlers) =>
		BrowserView.defineRPC({
			maxRequestTime: 5000,
			handlers: {
				requests: handlers,
				messages: {},
			},
		}),
	openWindow: (input) => {
		new BrowserWindow({
			title: input.title,
			url: input.url,
			frame: input.frame,
			rpc: input.rpc,
		});
		return input;
	},
});
