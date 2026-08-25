/**
 * Open an external URL in the default browser.
 * Electrobun has no opener plugin; window.open is the host path.
 */
export function openUrl(url: string): Promise<void> {
	if (typeof window !== "undefined") {
		window.open(url, "_blank", "noopener,noreferrer");
	}
	return Promise.resolve();
}
