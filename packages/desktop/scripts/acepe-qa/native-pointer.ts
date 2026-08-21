import { join } from "node:path";
import * as Effect from "effect/Effect";
import { type CommandRunner, runCommand, type TauriMcpFailure } from "./tauri-mcp";

export type ScreenPoint = {
	readonly x: number;
	readonly y: number;
};

export type NativePointerMover = (point: ScreenPoint) => Effect.Effect<null, TauriMcpFailure>;

export function moveNativePointer(
	point: ScreenPoint,
	runner: CommandRunner = runCommand
): Effect.Effect<null, TauriMcpFailure> {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return Effect.fail({
			code: "native_pointer_invalid_point",
			message: "Native pointer coordinates must be finite numbers.",
		});
	}
	const helperPath = join(import.meta.dir, "native-pointer.swift");
	return runner(["/usr/bin/swift", helperPath, point.x.toString(), point.y.toString()]).pipe(
		Effect.flatMap((execution) => {
			if (execution.code !== 0) {
				return Effect.fail({
					code: "native_pointer_move_failed",
					message:
						execution.stderr.trim() ||
						execution.stdout.trim() ||
						"The macOS pointer helper failed.",
				});
			}
			return Effect.succeed(null);
		})
	);
}
