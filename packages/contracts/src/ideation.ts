import { z } from 'zod';

export const IDEATION_PHASE_COUNT = 6;

export const ideationPhaseSchema = z.object({
  id: z.number().int().min(1).max(IDEATION_PHASE_COUNT),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(1500),
  questions: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  exitCheck: z.string().trim().min(1).max(1500),
});

export const ideationConfigSchema = z
  .object({
    phases: z.array(ideationPhaseSchema).length(IDEATION_PHASE_COUNT),
    extraInstructions: z.string().max(4000).optional(),
  })
  .strict()
  .refine((config) => config.phases.every((phase, index) => phase.id === index + 1), {
    message: 'phases must be ordered with ids 1 to 6',
    path: ['phases'],
  });

export type IdeationPhase = z.infer<typeof ideationPhaseSchema>;
export type IdeationConfig = z.infer<typeof ideationConfigSchema>;

export const DEFAULT_PHASES: readonly IdeationPhase[] = [
  {
    id: 1,
    title: 'Problem',
    goal: 'Pin down one specific, painful, real problem, described in the words of the people who actually have it, before any solution is discussed.',
    questions: [
      'What is the problem in one sentence, with no solution words in it?',
      'Who exactly has this problem, and when did you last see it happen?',
      'How often does it happen, and what does it cost them in time, money, risk or frustration?',
      'What words do the people who have it use to describe it?',
      'Why is this problem worth solving now, and why by your team?',
    ],
    exitCheck:
      'The team states one narrow problem without mentioning a solution, names who suffers from it, and gives at least one concrete example or data point showing it is real, frequent and costly.',
  },
  {
    id: 2,
    title: 'Users',
    goal: 'Define exactly who the primary user is, what they do today to cope, and how the team actually knows this rather than assuming it.',
    questions: [
      'Who is your primary user? Describe one specific person: role, context, constraints.',
      'What do they do today to deal with the problem, step by step?',
      'Why is their current workaround not good enough for them?',
      'How do you know: who did you talk to, what did you observe, what data did you find?',
      'Is the person who feels the pain the same person who would pay or decide?',
    ],
    exitCheck:
      'The team names a sharp primary user, describes their current workaround concretely, and backs it with real evidence such as conversations, observations or data rather than guesses.',
  },
  {
    id: 3,
    title: 'Prior work',
    goal: 'Find out what research, products and workarounds already exist for this problem, and learn honestly from what has been tried.',
    questions: [
      'Which existing products, services or tools already try to solve this?',
      'What research or published work exists on this problem?',
      'Why have earlier attempts failed, stalled or stayed niche?',
      'What do users like and dislike about the best existing option?',
      'What did you find that surprised you or challenged your assumptions?',
    ],
    exitCheck:
      'The team names at least two existing solutions or studies with sources, explains what each does well and where it falls short for their user, and has updated its view where the evidence demanded it.',
  },
  {
    id: 4,
    title: 'Gap & solution',
    goal: 'Identify what is genuinely missing from existing solutions and explain why the team’s idea fills that gap better for their user.',
    questions: [
      'What exactly is missing from the existing solutions you found?',
      'What is your idea in one sentence, and which part of the problem does it remove?',
      'Why would your user switch from what they use today?',
      'What insight or advantage do you have that others missed?',
      'What will you deliberately leave out of the first version?',
    ],
    exitCheck:
      'The team names a specific gap tied to their prior-work findings, explains their solution in one sentence, and gives a credible reason why their user would switch, without overclaiming.',
  },
  {
    id: 5,
    title: 'Feasibility',
    goal: 'Stress-test whether the team can actually build and validate the idea, and surface the riskiest assumption before judges do.',
    questions: [
      'What is the smallest prototype or test that proves the core value?',
      'Can your team build it with the skills, data and time you actually have?',
      'What technology, data, partners or permissions does it depend on?',
      'What is your riskiest assumption, and how would you test it cheaply?',
      'What legal, ethical or safety issues could block it?',
    ],
    exitCheck:
      'The team describes a realistic minimum prototype matched to its skills, names its dependencies, states its riskiest assumption, and has a cheap, concrete way to test it.',
  },
  {
    id: 6,
    title: 'Pitch & deck',
    goal: 'Turn phases 1 to 5 into a clear, honest 60-second pitch, prepare judge-proof answers, outline the slides, and review the uploaded deck against everything established so far.',
    questions: [
      'Can you explain the problem, user, evidence, gap and solution in 60 seconds?',
      'Which claim in your pitch is weakest, and what evidence backs it?',
      'What are the three hardest questions judges will ask, and what are your answers?',
      'What is your slide outline, and does every slide earn its place?',
      'Does your deck match what you established in phases 1 to 5, with no overclaims?',
    ],
    exitCheck:
      'The team delivers a 60-second pitch consistent with phases 1 to 5, has honest answers to likely judge questions, has a slide outline with one clear message per slide, and has addressed the deck review findings.',
  },
];

export function defaultIdeationConfig(): IdeationConfig {
  return { phases: DEFAULT_PHASES.map((phase) => ({ ...phase, questions: [...phase.questions] })) };
}
