import { redirect } from "@sveltejs/kit";
import { validateSession } from "$lib/server/auth/admin";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies }) => {
	const sessionId = cookies.get("session");

	if (!sessionId) {
		throw redirect(302, "/login");
	}

	const userResult = await Effect.runPromise(Effect.result(validateSession(sessionId)));

	if (Result.isFailure(userResult) || userResult.success === null) {
		cookies.delete("session", { path: "/" });
		throw redirect(302, "/login");
	}

	const user = userResult.success;

	if (!user.isAdmin) {
		throw redirect(302, "/");
	}

	return {
		user: {
			email: user.email,
			name: user.name,
			picture: user.picture,
		},
	};
};
