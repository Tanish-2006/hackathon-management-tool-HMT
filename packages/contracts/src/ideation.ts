import { z } from 'zod';

export const IDEATION_ROUND_COUNT = 5;

export const ideationRoundSchema = z.object({
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(1500),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  exitCriteria: z.string().trim().min(1).max(1500),
});

export const ideationConfigSchema = z.object({
  currentRound: z.number().int().min(1).max(IDEATION_ROUND_COUNT),
  rounds: z.array(ideationRoundSchema).length(IDEATION_ROUND_COUNT),
  extraInstructions: z.string().max(4000).optional(),
});

export type IdeationRound = z.infer<typeof ideationRoundSchema>;
export type IdeationConfig = z.infer<typeof ideationConfigSchema>;

export const DEFAULT_IDEATION_ROUNDS: readonly IdeationRound[] = [
  {
    title: 'Problem Discovery',
    goal: 'Pin down one specific, painful, real problem worth solving, described in the words of the people who have it, before any solution is discussed.',
    questions: [
      'What exact problem are you choosing, in one sentence, with no solution words in it?',
      'Who has this problem, and when did you last see it happen?',
      'How often does it happen and what does it cost them in time, money, risk or frustration?',
      'How do people cope with it today, and why is that not good enough?',
      'Why does this problem matter to your team in particular?',
    ],
    exitCriteria:
      'The team can state one narrow problem statement without mentioning a solution, names who suffers from it, gives at least one concrete example or data point showing it is real and frequent, and explains why current workarounds fall short.',
  },
  {
    title: 'Users & Validation',
    goal: 'Define the primary user precisely and gather evidence that they genuinely feel this problem, instead of relying on assumptions.',
    questions: [
      'Who is your primary user? Describe one specific person: role, context, constraints.',
      'Who pays or decides, and is that the same person who feels the pain?',
      'What evidence do you have that they care: conversations, surveys, reviews, forum posts, statistics?',
      'Which assumption about your users is riskiest, and how could you test it within the next few hours?',
      'What did you learn that surprised you or changed your view of the problem?',
    ],
    exitCriteria:
      'The team has a sharp primary user persona, has separated user from buyer where relevant, has cited at least two pieces of real evidence (ideally direct conversations), and has named its riskiest remaining assumption with a quick way to test it.',
  },
  {
    title: 'Solution & Differentiation',
    goal: 'Shape a focused solution concept that directly answers the validated problem and is clearly different from what already exists.',
    questions: [
      'What is the core idea in one sentence, and which part of the problem does it remove?',
      'What is the single most important thing a user does with it, step by step?',
      'Which existing products, services or workarounds compete with it, and where do they fail this user?',
      'What is your unfair advantage or unique insight that others are missing?',
      'What will you deliberately leave out of the first version?',
    ],
    exitCriteria:
      'The team can explain the solution in one sentence, walk through the core user flow, name at least two alternatives and why they fall short, state a credible differentiator, and list what is explicitly out of scope.',
  },
  {
    title: 'Feasibility & Business Model',
    goal: 'Stress-test whether the idea can actually be built and sustained: technology, resources, risks, and how it creates and captures value.',
    questions: [
      'What is the smallest prototype that proves the core value, and can your team build it with the skills and time you have?',
      'What technology, data, partners or permissions does it depend on, and which are uncertain?',
      'Who pays, how much, and why would they pay rather than keep their workaround?',
      'What are the main costs to build and run it, and how does it reach its first 100 users?',
      'What are the top three risks (technical, legal, ethical, market) and how would you reduce each?',
    ],
    exitCriteria:
      'The team has a realistic minimum prototype matched to its skills, identified key dependencies, a plausible revenue or sustainability model with a named payer, a first go-to-market channel, and the top risks with mitigations.',
  },
  {
    title: 'Pitch & Final Refinement',
    goal: 'Turn the work of the previous rounds into a clear, honest, evidence-backed pitch and close any remaining gaps.',
    questions: [
      'Can you tell the story in under two minutes: problem, user, evidence, solution, differentiation, model, ask?',
      'Which claim in your pitch is weakest, and what evidence or demo moment would make it convincing?',
      'What will judges most likely challenge, and how will you answer?',
      'What is the single memorable line or moment you want the audience to remember?',
      'What would you build or test next if you had one more month?',
    ],
    exitCriteria:
      'The team has a tight pitch narrative that connects every earlier round, backs key claims with evidence, has prepared answers to likely judge questions, and states a clear next step.',
  },
];

export function defaultIdeationConfig(): IdeationConfig {
  return {
    currentRound: 1,
    rounds: DEFAULT_IDEATION_ROUNDS.map((round) => ({ ...round, questions: [...round.questions] })),
  };
}
