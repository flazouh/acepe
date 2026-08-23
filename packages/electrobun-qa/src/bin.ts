import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { executeCli, printCliResult } from "./cli.ts";
import { QaUnknownCommand } from "./errors.ts";

const readStdin = Effect.tryPromise({
	try: () => Bun.stdin.text(),
	catch: (cause) =>
		new QaUnknownCommand({
			command: Predicate.isError(cause) === true ? cause.message : "stdin",
		}),
});

const runMain = Effect.fn("runMain")(function* () {
	const argv = Bun.argv.slice(2);
	const result = yield* executeCli({
		argv,
		stdin: readStdin,
	});
	return yield* printCliResult(result);
});

const code = await Effect.runPromise(runMain());
if (code !== 0) {
	process.exit(code);
}
