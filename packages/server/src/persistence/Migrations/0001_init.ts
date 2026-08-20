import * as Effect from "effect/Effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const init = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`SELECT 1`.withoutTransform
})

export default init
