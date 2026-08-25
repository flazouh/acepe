export type DownloadEvent =
	| { readonly event: "Started"; readonly data: { readonly contentLength?: number } }
	| { readonly event: "Progress"; readonly data: { readonly chunkLength: number } }
	| { readonly event: "Finished" };

export type Update = {
	readonly version: string;
	download: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
	install: () => Promise<void>;
};
