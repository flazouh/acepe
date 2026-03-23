import type MarkdownIt from "markdown-it";

/**
 * WeakMap to store repo context for each MarkdownIt renderer instance.
 * Allows passing repo context through the rendering pipeline without mutating the renderer.
 * Used by the GitHub badge plugin to resolve owner/repo for bare commit SHAs.
 */
export const rendererRepoContext = new WeakMap<MarkdownIt, { owner: string; repo: string }>();
