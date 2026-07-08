const DEFAULT_TEXT = "QA transcript scroll probe: reply with ok";

function valueArg(name: string, fallback: string): string {
	const prefix = `${name}=`;
	const directIndex = process.argv.indexOf(name);
	if (directIndex >= 0) {
		return process.argv[directIndex + 1] ?? fallback;
	}
	const value = process.argv.find((arg) => arg.startsWith(prefix));
	if (value === undefined) {
		return fallback;
	}
	const parsed = value.slice(prefix.length).trim();
	return parsed.length > 0 ? parsed : fallback;
}

const command = [
	"bun",
	"run",
	"scripts/acepe-qa.ts",
	"first-send-probe",
	"--text",
	valueArg("--text", DEFAULT_TEXT),
	"--timeout",
	valueArg("--timeout", "5000"),
	"--app",
	valueArg("--app", "9223"),
];

const child = Bun.spawn(command, {
	stdout: "inherit",
	stderr: "inherit",
});

process.exit(await child.exited);
