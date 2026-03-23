function hasFlagValue(argv: readonly string[], flag: string, expectedValue: string): boolean {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === `${flag}=${expectedValue}`) {
			return true;
		}
		if (arg === flag && argv[index + 1] === expectedValue) {
			return true;
		}
	}
	return false;
}

export function shouldRunClaudeCli(argv: readonly string[]): boolean {
	if (argv.includes("--cli")) {
		return true;
	}

	// SDK process transport invokes Claude CLI with stream-json I/O flags.
	const hasStreamJsonOutput = hasFlagValue(argv, "--output-format", "stream-json");
	const hasStreamJsonInput = hasFlagValue(argv, "--input-format", "stream-json");
	return hasStreamJsonOutput && hasStreamJsonInput;
}

export function removeExplicitCliFlag(argv: readonly string[]): string[] {
	return argv.filter((arg) => arg !== "--cli");
}
