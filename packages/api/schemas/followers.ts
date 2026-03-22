import { z } from 'zod';

export const followOutput = z.object({ following: z.boolean() });
export type FollowOutput = z.infer<typeof followOutput>;
