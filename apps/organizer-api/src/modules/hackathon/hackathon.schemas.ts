import { z } from 'zod';

export const draftInputSchema = z.object({
  hackathonName: z.string().min(1, 'hackathonName required'),
  objective: z.string().min(1),
  audience: z.string().min(1),
  duration: z.string().min(1),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  themePreference: z.string().min(1),
  problemStatementBasedOrOpenInnovation: z.enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID']),
  expectedOutcomes: z.string().min(1),
  judgingPreferences: z.string().min(1),
  resources: z.string().min(1),
  rules: z.string().min(1),
});

// ---- Quick-create wizard: organizer answers 5 questions; AI drafts the rest ----
export const wizardInputSchema = z.object({
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  about: z.string().min(3, 'Tell us what the hackathon is about').max(2000),
  hackathonType: z.enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID']),
  eligibility: z.array(z.enum(['Students', 'Developers', 'Designers', 'Professionals', 'Anyone'])).min(1).max(5),
  customEligibility: z.string().max(300).optional().nullable(),
  durationPlus: z.string().min(1, 'Duration / requirements required').max(2000),
});

export const regenerateSectionSchema = z.object({
  section: z.enum([
    'title',
    'tagline',
    'description',
    'theme',
    'problemStatements',
    'openInnovation',
    'rules',
    'guidelines',
    'codeOfConduct',
    'timeline',
    'evaluationCriteria',
    'resources',
    'faqs',
    'prizes',
    'announcement',
    'eligibility',
    'teamSize',
    'participationInstructions',
  ]),
  instruction: z.string().max(500).optional().nullable(),
});

// ---- Structured validation for wizard drafts: malformed AI output is never stored ----
export const wizardDraftSchema = z.object({
  title: z.string().min(1).max(160),
  tagline: z.string().max(220).optional().nullable(),
  description: z.string().min(1).max(8000),
  theme: z.string().max(160).optional().nullable(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  hackathonType: z.enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID']),
  eligibility: z.array(z.string().max(120)).max(12).optional().nullable(),
  teamSize: z.object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) }).optional().nullable(),
  problemStatements: z.array(z.string().max(1000)).max(10).optional().nullable(),
  openInnovation: z.object({ guidelines: z.array(z.string().max(1000)).max(10) }).optional().nullable(),
  rules: z.array(z.string().max(1000)).max(20).optional().nullable(),
  guidelines: z.array(z.string().max(1000)).max(20).optional().nullable(),
  codeOfConduct: z.array(z.string().max(1000)).max(20).optional().nullable(),
  timeline: z.array(z.object({ name: z.string().max(80), order: z.number().int().min(1), description: z.string().max(500) })).max(12).optional().nullable(),
  evaluationCriteria: z.array(z.object({ name: z.string().max(120), description: z.string().max(500), weight: z.number().min(0).max(1) })).max(10).optional().nullable(),
  resources: z.array(z.object({ title: z.string().max(160), type: z.string().max(20), url: z.string().max(500).optional().nullable() })).max(15).optional().nullable(),
  faqs: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1500) })).max(15).optional().nullable(),
  prizes: z.array(z.object({ title: z.string().max(160), description: z.string().max(1000) })).max(10).optional().nullable(),
  announcement: z.string().max(4000).optional().nullable(),
  participationInstructions: z.string().max(2000).optional().nullable(),
}).strict();

export const manualCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  hackathonType: z.enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID']).optional(),
  objective: z.string().optional(),
  audience: z.string().optional(),
  duration: z.string().optional(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
  themeIds: z.array(z.string()).optional(),
  problemStatement: z.string().nullable().optional(),
  constraints: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  expectedOutcomes: z.array(z.string()).optional(),
  judgingPreferences: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  registrationStart: z.string().datetime().nullable().optional(),
  registrationEnd: z.string().datetime().nullable().optional(),
  eventStart: z.string().datetime().nullable().optional(),
  eventEnd: z.string().datetime().nullable().optional(),
  eligibility: z.array(z.string().max(120)).max(12).optional(),
  teamSize: z.object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) }).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  organizerName: z.string().max(160).nullable().optional(),
});

export const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  hackathonType: z.enum(['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID']).optional(),
  objective: z.string().optional(),
  audience: z.string().optional(),
  duration: z.string().optional(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
  themeIds: z.array(z.string()).optional(),
  problemStatement: z.string().nullable().optional(),
  constraints: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  expectedOutcomes: z.array(z.string()).optional(),
  judgingPreferences: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
  // Wizard extended sections (persisted into metadata.draft; organizer edits override AI).
  tagline: z.string().max(220).nullable().optional(),
  guidelines: z.array(z.string().max(1000)).max(20).optional(),
  codeOfConduct: z.array(z.string().max(1000)).max(20).optional(),
  faqs: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1500) })).max(15).optional(),
  prizes: z.array(z.object({ title: z.string().max(160), description: z.string().max(1000) })).max(10).optional(),
  announcement: z.string().max(4000).nullable().optional(),
  eligibility: z.array(z.string().max(120)).max(12).optional(),
  teamSize: z.object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) }).nullable().optional(),
  participationInstructions: z.string().max(2000).nullable().optional(),
  openInnovation: z.object({ guidelines: z.array(z.string().max(1000)).max(10) }).nullable().optional(),
  problemStatements: z.array(z.string().max(1000)).max(10).optional(),
  theme: z.string().max(160).nullable().optional(),
  registrationStart: z.string().datetime().nullable().optional(),
  registrationEnd: z.string().datetime().nullable().optional(),
  eventStart: z.string().datetime().nullable().optional(),
  eventEnd: z.string().datetime().nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  organizerName: z.string().max(160).nullable().optional(),
  // Step 8 Participation & Submission config (stored in metadata.draft.participation;
  // cross-field rules enforced server-side in HackathonService.update).
  participation: z
    .object({
      mode: z.enum(['INDIVIDUAL', 'TEAMS', 'BOTH']),
      teamSize: z.object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) }).nullable().optional(),
      eligibility: z.array(z.enum(['Students', 'Developers', 'Designers', 'Professionals', 'Anyone'])).max(12).optional(),
      approval: z.enum(['AUTOMATIC', 'ORGANIZER_APPROVAL']).optional(),
      participantLimit: z.number().int().min(1).nullable().optional(),
      // GitHub repository requirement per team/project (wizard Step 8).
      // Absent on old records → OPTIONAL (safe default, never breaks).
      repoRequirement: z.enum(['REQUIRED', 'OPTIONAL', 'DISABLED']).optional(),
      submission: z
        .object({
          required: z.array(z.enum(['TITLE', 'DESCRIPTION', 'REPO', 'DEMO_URL', 'VIDEO', 'PRESENTATION', 'DOCS'])).optional(),
          teamSubmission: z.boolean().optional(),
          lateAllowed: z.boolean().optional(),
          maxSubmissions: z.number().int().min(1).nullable().optional(),
        })
        .optional(),
    })
    .nullable()
    .optional(),
});
