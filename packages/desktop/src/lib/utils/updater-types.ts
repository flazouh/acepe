export type DownloadEvent =
	| { readonly event: "Started"; readonly data: { readonly contentLength?: number } }
	| { readonly event: "Progress"; readonly data: { readonly chunkLength: number } }
	| { readonly event: "Finished" };

export type Update = {
	readonly version: string;
	download: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
	install: () => Promise<void>;
};

/**
 * What one update check settled on.
 *
 * A check that failed is its own answer. Reading it as "no update" would hide
 * a broken updater behind a quiet app, and dropping it would strand the banner
 * on "Checking update..." for the rest of the session. Every caller has to
 * handle all three.
 */
export type UpdateCheckOutcome =
	| { readonly kind: "available"; readonly update: Update }
	| { readonly kind: "none" }
	| { readonly kind: "failed"; readonly message: string };
