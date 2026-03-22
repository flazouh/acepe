import type MarkdownIt from "markdown-it";

export type MarkdownPlugin = (md: MarkdownIt) => void;
