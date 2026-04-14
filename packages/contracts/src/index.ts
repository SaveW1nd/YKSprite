import { z } from 'zod';

export const problemOptionSchema = z.object({
  key: z.string(),
  value: z.string()
});

export const problemSchema = z.object({
  id: z.string(),
  type: z.enum(['single_choice', 'multiple_choice', 'fill_in', 'subjective']),
  body: z.string(),
  options: z.array(problemOptionSchema).default([])
});

export type Problem = z.infer<typeof problemSchema>;
