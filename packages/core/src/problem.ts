export type Problem = {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  body: string;
  options?: Array<{ key: string; value: string }>;
};
