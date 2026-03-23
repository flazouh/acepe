/**
 * Markdown file extensions that should be treated as markdown files.
 *
 * Used for determining when to show markdown preview mode in the edit tool.
 */
export const MARKDOWN_EXTENSIONS = ["md", "mdx", "markdown"] as const;

/**
 * Type for markdown extension values.
 */
export type MarkdownExtension = (typeof MARKDOWN_EXTENSIONS)[number];
