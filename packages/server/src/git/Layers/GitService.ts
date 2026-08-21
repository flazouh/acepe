import * as Layer from "effect/Layer"
import { makeGitService, type GitServiceLiveOptions } from "../makeGitService.ts"
import { GitService } from "../Services/GitService.ts"

export type { GitServiceLiveOptions }

export const GitServiceLive = (options: GitServiceLiveOptions) =>
	Layer.effect(GitService, makeGitService(options))
