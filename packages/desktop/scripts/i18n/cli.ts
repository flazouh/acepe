/**
 * CLI interface for i18n translation tool
 */

import { getLanguageName } from "./config";
import type { TranslationResult } from "./types";

// ANSI color codes for terminal output
const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
};

// Spinner frames for loading animation
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class CLI {
	private spinnerInterval: ReturnType<typeof setInterval> | null = null;
	private currentFrame = 0;
	private currentMessage = "";

	/**
	 * Print styled header
	 */
	printHeader(): void {
		console.log("");
		console.log(
			`${colors.bold}${colors.cyan}  ╭─────────────────────────────────────╮${colors.reset}`
		);
		console.log(
			`${colors.bold}${colors.cyan}  │${colors.reset}   ${colors.bold}Acepe i18n Translation Tool${colors.reset}       ${colors.bold}${colors.cyan}│${colors.reset}`
		);
		console.log(
			`${colors.bold}${colors.cyan}  │${colors.reset}   ${colors.dim}Powered by Claude Haiku${colors.reset}            ${colors.bold}${colors.cyan}│${colors.reset}`
		);
		console.log(
			`${colors.bold}${colors.cyan}  ╰─────────────────────────────────────╯${colors.reset}`
		);
		console.log("");
	}

	/**
	 * Print configuration summary
	 */
	printConfig(config: {
		sourceKeyCount: number;
		languageCount: number;
		mode: string;
		targetLang?: string;
	}): void {
		console.log(`${colors.dim}  Configuration:${colors.reset}`);
		console.log(
			`${colors.dim}  ├─${colors.reset} Source: ${colors.bold}${config.sourceKeyCount}${colors.reset} keys in en.json`
		);
		console.log(
			`${colors.dim}  ├─${colors.reset} Mode: ${colors.bold}${config.mode}${colors.reset}`
		);
		console.log(
			`${colors.dim}  └─${colors.reset} Target: ${colors.bold}${config.targetLang ? getLanguageName(config.targetLang) : `${config.languageCount} languages`}${colors.reset}`
		);
		console.log("");
	}

	/**
	 * Start a spinner with a message
	 */
	startSpinner(message: string): void {
		this.currentMessage = message;
		this.currentFrame = 0;

		// Clear any existing spinner
		this.stopSpinner();

		this.spinnerInterval = setInterval(() => {
			const frame = spinnerFrames[this.currentFrame];
			process.stdout.write(`\r${colors.cyan}${frame}${colors.reset} ${this.currentMessage}`);
			this.currentFrame = (this.currentFrame + 1) % spinnerFrames.length;
		}, 80);
	}

	/**
	 * Update spinner message
	 */
	updateSpinner(message: string): void {
		this.currentMessage = message;
	}

	/**
	 * Stop the spinner
	 */
	stopSpinner(): void {
		if (this.spinnerInterval) {
			clearInterval(this.spinnerInterval);
			this.spinnerInterval = null;
			process.stdout.write("\r\x1b[K"); // Clear line
		}
	}

	/**
	 * Print success message with checkmark
	 */
	success(message: string): void {
		this.stopSpinner();
		console.log(`${colors.green}✓${colors.reset} ${message}`);
	}

	/**
	 * Print warning message
	 */
	warn(message: string): void {
		this.stopSpinner();
		console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
	}

	/**
	 * Print error message
	 */
	error(message: string): void {
		this.stopSpinner();
		console.log(`${colors.red}✗${colors.reset} ${message}`);
	}

	/**
	 * Print info message
	 */
	info(message: string): void {
		console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
	}

	/**
	 * Print language translation result
	 */
	printLanguageResult(result: TranslationResult): void {
		const langDisplay = `${result.langCode} (${result.langName})`;

		if (result.errors.length > 0) {
			console.log(
				`  ${colors.red}✗${colors.reset} ${langDisplay}: ${colors.red}${result.errors[0]}${colors.reset}`
			);
		} else if (result.translated > 0) {
			console.log(
				`  ${colors.green}✓${colors.reset} ${langDisplay}: ${colors.green}${result.translated} translated${colors.reset}`
			);
		} else {
			console.log(
				`  ${colors.dim}○${colors.reset} ${langDisplay}: ${colors.dim}up to date${colors.reset}`
			);
		}
	}

	/**
	 * Print progress bar
	 */
	printProgress(current: number, total: number, width: number = 30): string {
		const percentage = Math.round((current / total) * 100);
		const filled = Math.round((current / total) * width);
		const empty = width - filled;

		const bar = `${colors.green}${"█".repeat(filled)}${colors.dim}${"░".repeat(empty)}${colors.reset}`;
		return `${bar} ${percentage}%`;
	}

	/**
	 * Print final summary
	 */
	printSummary(results: TranslationResult[]): void {
		console.log("");
		console.log(`${colors.dim}  ─────────────────────────────────────${colors.reset}`);

		const totalTranslated = results.reduce((sum, r) => sum + r.translated, 0);
		const successCount = results.filter((r) => r.errors.length === 0).length;
		const errorCount = results.filter((r) => r.errors.length > 0).length;

		console.log(
			`  ${colors.bold}Summary:${colors.reset} ${colors.green}${totalTranslated}${colors.reset} strings translated`
		);
		console.log(
			`  ${colors.bold}Languages:${colors.reset} ${colors.green}${successCount} successful${colors.reset}${errorCount > 0 ? `, ${colors.red}${errorCount} failed${colors.reset}` : ""}`
		);
		console.log("");
	}

	/**
	 * Print help message
	 */
	printHelp(): void {
		console.log(`
${colors.bold}Usage:${colors.reset}
  bun run translate:haiku [options]

${colors.bold}Options:${colors.reset}
  --all           Re-translate all keys (default: only missing keys)
  --lang=<code>   Only translate specific language (e.g., --lang=fr)
  --dry-run       Show what would be translated without making changes
  --help          Show this help message

${colors.bold}Examples:${colors.reset}
  bun run translate:haiku              # Translate missing keys for all languages
  bun run translate:haiku --all        # Re-translate everything
  bun run translate:haiku --lang=ja    # Only translate Japanese
  bun run translate:haiku --dry-run    # Preview without changes

${colors.bold}Environment:${colors.reset}
  OPENROUTER_API_KEY    Required. Your OpenRouter API key.
`);
	}

	/**
	 * Print dry-run preview
	 */
	printDryRun(langCode: string, langName: string, keysToTranslate: Record<string, string>): void {
		const keyCount = Object.keys(keysToTranslate).length;

		if (keyCount === 0) {
			console.log(
				`  ${colors.dim}○${colors.reset} ${langCode} (${langName}): ${colors.dim}up to date${colors.reset}`
			);
			return;
		}

		console.log(
			`  ${colors.yellow}●${colors.reset} ${langCode} (${langName}): ${colors.yellow}${keyCount} keys to translate${colors.reset}`
		);

		// Show first few keys
		const keys = Object.keys(keysToTranslate).slice(0, 3);
		for (const key of keys) {
			console.log(`    ${colors.dim}└─${colors.reset} ${key}`);
		}

		if (keyCount > 3) {
			console.log(`    ${colors.dim}└─ ... and ${keyCount - 3} more${colors.reset}`);
		}
	}
}
