import type { HackathonDraft, HackathonMode, HackathonType, WizardInput } from '../../domain/types';

/**
 * Wizard content builder — deterministic mock for the quick-create flow.
 * Used as fallback when the AI Gateway is unavailable/fails in non-prod,
 * and as the section-level regeneration engine (variant rotation).
 *
 * Rules:
 * - Never fabricate real sponsors, URLs, venues, prizes, or exact calendar dates.
 * - Placeholders only (example.com, "to be announced by organizer").
 * - Output is DATA validated by wizardDraftSchema before anything is stored.
 */

const CODE_OF_CONDUCT = [
  'Be respectful and inclusive — harassment of any kind is not tolerated.',
  'Submit original work created during the event unless the rules state otherwise.',
  'Respect fellow builders, mentors, judges, and organizers.',
  'Keep shared spaces safe and welcoming for everyone.',
  'Follow the event rules and the decisions of the organizing team.',
];

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function deriveWorkingTitle(about: string): string {
  const words = clean(about).split(' ').filter(Boolean).slice(0, 6).join(' ');
  const titled = words.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  return (titled || 'Untitled Hackathon').slice(0, 120);
}

export function splitDurationPlus(durationPlus: string): { duration: string; requirements: string } {
  const lines = durationPlus.split('\n').map((l) => l.trim()).filter(Boolean);
  const duration = (lines[0] ?? durationPlus).slice(0, 120) || 'To be announced';
  const requirements = lines.slice(1).join('\n').slice(0, 1500);
  return { duration, requirements };
}

export function eligibilityToAudience(eligibility: string[], custom?: string | null): string {
  const parts = [...eligibility];
  if (custom?.trim()) parts.push(`Custom: ${custom.trim()}`);
  if (parts.includes('Anyone')) return 'Open to everyone';
  return parts.join(', ') || 'Open to everyone';
}

export function modeParticipationInstructions(mode: HackathonMode): string {
  if (mode === 'ONLINE') {
    return 'Fully virtual: join from anywhere. Team formation, hacking, submissions, and evaluation all happen online. Submissions are made through the event platform before the deadline.';
  }
  if (mode === 'OFFLINE') {
    return 'In-person: check in on-site at the venue announced by the organizer. Team formation, hacking, and demos happen at the venue. Bring your own hardware unless the organizer states otherwise.';
  }
  return 'Hybrid: participate online or on-site at the venue announced by the organizer. Team formation and hacking work across both tracks. Submissions are made through the event platform; finals may be presented on-site and streamed online.';
}

function problemStatementsFor(about: string, audience: string, mode: HackathonMode, variant: number): string[] {
  const base = [
    `Build a working prototype that addresses "${about}" for ${audience}.`,
    `Design an accessible, demo-ready solution in the "${about}" space that a small team can ship within the event.`,
    `Create a solution with a clear user, a clear problem in "${about}", and measurable impact.`,
  ];
  const modeNote =
    mode === 'ONLINE'
      ? 'Solutions must be demoable remotely (video + live link).'
      : mode === 'OFFLINE'
        ? 'Solutions must be demoable live on-site.'
        : 'Solutions must be demoable both remotely and on-site.';
  const rotated = [...base.slice(variant % base.length), ...base.slice(0, variant % base.length)];
  return [...rotated, modeNote];
}

function openInnovationFor(about: string, variant: number): { guidelines: string[] } {
  const all = [
    `Pick any meaningful problem connected to "${about}" and define it clearly.`,
    'Original work created during the event, unless the rules allow pre-existing components.',
    'Ship a functional prototype plus a short demo (video or live walkthrough).',
    'Document your idea, stack, and setup steps in the project README.',
    'Judging rewards novelty, execution quality, and real-world usefulness.',
  ];
  return { guidelines: [...all.slice(variant % all.length), ...all.slice(0, variant % all.length)] };
}

function faqsFor(mode: HackathonMode, audience: string, duration: string): Array<{ question: string; answer: string }> {
  return [
    { question: 'Who can participate?', answer: audience },
    { question: 'How long is the event?', answer: duration },
    {
      question: 'Where does it take place?',
      answer:
        mode === 'ONLINE'
          ? 'Fully online — links and schedule will be shared by the organizer.'
          : mode === 'OFFLINE'
            ? 'In person — the venue will be announced by the organizer.'
            : 'Hybrid — join online or on-site; the venue will be announced by the organizer.',
    },
    { question: 'What should we submit?', answer: 'A working prototype, a demo (video or live), and a README describing your solution.' },
    { question: 'How are projects evaluated?', answer: 'Mentors and judges score submissions against the published evaluation criteria.' },
  ];
}

function prizesFor(requirements: string): Array<{ title: string; description: string }> {
  const lines = requirements.split('\n').map((l) => l.trim()).filter((l) => /prize/i.test(l));
  if (!lines.length) return [];
  // Use organizer-provided text verbatim (truncated) — never invent amounts or sponsors.
  return lines.slice(0, 5).map((l, i) => ({ title: `Prize ${i + 1}`, description: l.slice(0, 500) }));
}

const RULE_VARIANTS: string[][] = [
  ['Original work only', 'All submissions must include a README and demo link', 'Respect the code of conduct'],
  ['Ship original work created during the event', 'Include setup instructions with every submission', 'One submission per team'],
  ['Build in the open and document your process', 'Demo must be reproducible by judges', 'Follow the published timeline'],
];

const TIMELINE: Array<{ name: string; order: number; description: string }> = [
  { name: 'registration', order: 1, description: 'Register and verify eligibility' },
  { name: 'team_formation', order: 2, description: 'Form teams or join existing teams' },
  { name: 'ideation', order: 3, description: 'Refine ideas and align with mentor feedback' },
  { name: 'development', order: 4, description: 'Build and iterate on the solution' },
  { name: 'submission', order: 5, description: 'Submit project and demo' },
  { name: 'evaluation', order: 6, description: 'Mentor and judge evaluation' },
  { name: 'results', order: 7, description: 'Results announcement and awards' },
];

export interface WizardSections {
  title: string;
  tagline: string;
  description: string;
  theme: string;
  mode: HackathonMode;
  hackathonType: HackathonType;
  eligibility: string[];
  teamSize: { min: number; max: number; recommended: number };
  problemStatements: string[];
  openInnovation: { guidelines: string[] };
  participationInstructions: string;
  rules: string[];
  guidelines: string[];
  codeOfConduct: string[];
  timeline: typeof TIMELINE;
  evaluationCriteria: Array<{ name: string; description: string; weight: number }>;
  resources: Array<{ title: string; type: string; url?: string }>;
  faqs: Array<{ question: string; answer: string }>;
  prizes: Array<{ title: string; description: string }>;
  announcement: string;
}

/** Build the full extended draft from the 5 wizard answers (deterministic mock). */
export function buildWizardSections(input: WizardInput, variant = 0): WizardSections {
  const about = clean(input.about);
  const { duration, requirements } = splitDurationPlus(input.durationPlus);
  const audience = eligibilityToAudience(input.eligibility, input.customEligibility);
  const title = deriveWorkingTitle(about);
  const theme = about.split(' ').slice(0, 3).join(' ') || 'Open Innovation';
  const type = input.hackathonType;
  const wantsProblems = type === 'PROBLEM_STATEMENT_BASED' || type === 'HYBRID';
  const problemStatements = wantsProblems ? problemStatementsFor(about, audience, input.mode, variant) : [];
  const problemLine = wantsProblems ? ` Problem statements: ${problemStatements[0] ?? ''}` : '';
  const rules = RULE_VARIANTS[variant % RULE_VARIANTS.length];
  if (requirements) rules.push(`Organizer notes: ${requirements.slice(0, 300)}`);
  return {
    title,
    tagline: `${about.slice(0, 120)} — build it together.`,
    description: `${about} — Target audience: ${audience}. Mode: ${input.mode}. Duration: ${duration}.${problemLine} [AI draft — organizer review required]`,
    theme,
    mode: input.mode,
    hackathonType: type,
    eligibility: [...input.eligibility, ...(input.customEligibility?.trim() ? [`Custom: ${input.customEligibility.trim()}`] : [])],
    teamSize: { min: 1, max: 4, recommended: 3 },
    problemStatements,
    openInnovation: type === 'OPEN_INNOVATION' || type === 'HYBRID' ? openInnovationFor(about, variant) : { guidelines: [] },
    participationInstructions: modeParticipationInstructions(input.mode),
    rules,
    guidelines: [
      'Form your team during team formation and register your project early.',
      'Use the published resources and ask mentors during office hours.',
      'Submit before the deadline — late submissions are not evaluated.',
    ],
    codeOfConduct: [...CODE_OF_CONDUCT],
    timeline: TIMELINE,
    evaluationCriteria: [
      { name: 'Innovation', description: 'Novelty of the solution', weight: 0.34 },
      { name: 'Technical implementation', description: 'Code quality and execution', weight: 0.33 },
      { name: 'Impact', description: 'Real-world value', weight: 0.33 },
    ],
    resources: [{ title: 'Starter Kit - Docs & APIs', type: 'STARTER', url: 'https://example.com/starter-kit' }],
    faqs: faqsFor(input.mode, audience, duration),
    prizes: prizesFor(requirements),
    announcement: `Announcing "${title}" — ${about} Join ${audience} for ${duration} of building. Details, timeline, and rules will be confirmed by the organizer before launch.`,
  };
}

/** Regenerate ONE section only (variant rotation keeps it deterministic but fresh). */
export function rebuildSection(
  section: keyof Omit<WizardSections, 'mode' | 'hackathonType'>,
  input: { about: string; audience: string; mode: HackathonMode; hackathonType: HackathonType; duration: string; requirements: string; eligibility: string[] },
  variant: number,
): unknown {
  const wizardInput: WizardInput = {
    mode: input.mode,
    about: input.about,
    hackathonType: input.hackathonType,
    eligibility: [],
    durationPlus: input.duration + (input.requirements ? `\n${input.requirements}` : ''),
  };
  const full = buildWizardSections(wizardInput, variant);
  // Re-derive audience-dependent sections from stored values (never trust client for these).
  if (section === 'faqs') return faqsFor(input.mode, input.audience, input.duration);
  if (section === 'problemStatements') {
    const wants = input.hackathonType === 'PROBLEM_STATEMENT_BASED' || input.hackathonType === 'HYBRID';
    return wants ? problemStatementsFor(input.about, input.audience, input.mode, variant) : [];
  }
  if (section === 'prizes') return prizesFor(input.requirements);
  if (section === 'eligibility') return input.eligibility;
  if (section === 'participationInstructions') return modeParticipationInstructions(input.mode);
  if (section === 'openInnovation') {
    return input.hackathonType === 'OPEN_INNOVATION' || input.hackathonType === 'HYBRID'
      ? openInnovationFor(input.about, variant)
      : { guidelines: [] };
  }
  return (full as unknown as Record<string, unknown>)[section];
}

/** Map a wizard draft onto the base HackathonDraft shape the gateway validates. */
export function toBaseDraft(sections: WizardSections, input: WizardInput): HackathonDraft {
  const { duration } = splitDurationPlus(input.durationPlus);
  const audience = eligibilityToAudience(input.eligibility, input.customEligibility);
  return {
    title: sections.title,
    description: sections.description,
    hackathonType: sections.hackathonType,
    objective: clean(input.about),
    audience,
    duration,
    mode: sections.mode,
    theme: sections.theme,
    problemStatement: sections.problemStatements[0] ?? (sections.hackathonType === 'PROBLEM_STATEMENT_BASED' ? `${clean(input.about)}.` : null),
    constraints: sections.rules.slice(0, 8),
    expectedOutcomes: ['Functional prototype', 'Demo video'],
    judgingCriteriaDraft: sections.evaluationCriteria,
    resourcesDraft: sections.resources.map((r) => ({ title: r.title, type: r.type as HackathonDraft['resourcesDraft'][number]['type'], url: r.url })),
    rulesDraft: sections.rules,
    phasesDraft: sections.timeline.map((t) => ({ name: t.name, order: t.order, description: t.description })),
    generatedAt: new Date().toISOString(),
    generatorVersion: 'wizard-v1',
    tagline: sections.tagline,
    eligibility: sections.eligibility,
    teamSize: sections.teamSize,
    problemStatements: sections.problemStatements,
    openInnovation: sections.openInnovation,
    participationInstructions: sections.participationInstructions,
    guidelines: sections.guidelines,
    codeOfConduct: sections.codeOfConduct,
    faqs: sections.faqs,
    prizes: sections.prizes,
    announcement: sections.announcement,
  };
}
