/**
 * Supported shell languages for syntax highlighting.
 *
 * These languages are supported by the Shiki highlighter used in the execute tool.
 * The highlighter also loads `log` for terminal stdout/stderr (see bash-highlighter).
 */
export const SUPPORTED_SHELL_LANGUAGES = ["bash", "sh", "shell"] as const;

/**
 * Default language to use for command highlighting.
 */
export const DEFAULT_SHELL_LANGUAGE = "bash" as const;
