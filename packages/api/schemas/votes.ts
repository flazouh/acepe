import { z } from 'zod';
import { voteType } from './common.js';

export const castVoteInput = z.object({ voteType });
export type CastVoteInput = z.infer<typeof castVoteInput>;
