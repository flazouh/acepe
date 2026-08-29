/**
 * Token values are read from the live document, so every swatch must re-read
 * when the theme attribute flips. This counter is the single dependency the
 * swatches subscribe to.
 */
let version = $state(0);

/** Bump on any `data-theme` change. Call once, from the design-system layout. */
export function observeThemeChanges(root: HTMLElement): () => void {
	const observer = new MutationObserver(() => {
		version += 1;
	});
	observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
	return () => observer.disconnect();
}

/** Read inside a `$derived` to make it recompute after a theme change. */
export function themeVersion(): number {
	return version;
}
