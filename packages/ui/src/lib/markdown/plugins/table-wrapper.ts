import type MarkdownIt from "markdown-it";

/**
 * Customizes table rendering to wrap tables in a scrollable container.
 */
export function tableWrapperPlugin(md: MarkdownIt): void {
	const defaultTableOpen =
		md.renderer.rules.table_open ||
		((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
	const defaultTableClose =
		md.renderer.rules.table_close ||
		((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

	md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
		`<div class="table-wrapper"><${defaultTableOpen(tokens, idx, options, env, self).slice(1)}`;

	md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
		`${defaultTableClose(tokens, idx, options, env, self)}</div>`;
}
