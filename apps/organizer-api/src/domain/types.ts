import type { Role } from '@hmt/common';

// Re-export Role for convenience
export type { Role };

// ======================================================
// Hackathon Domain Types
// ======================================================

export const HackathonStatusValues = ['DRAFT', 'REVIEW', 'CONFIRMED', 'PUBLISHED', 'ARCHIVED'] as const;
export type HackathonStatus = (typeof HackathonStatusValues)[number];

export const HackathonTypeValues = ['PROBLEM_STATEMENT_BASED', 'OPEN_INNOVATION', 'HYBRID'] as const;
export type HackathonType = (typeof HackathonTypeValues)[number];

export const HackathonModeValues = ['ONLINE', 'OFFLINE', 'HYBRID'] as const;
export type HackathonMode = (typeof HackathonModeValues)[number];

export const PhaseNameValues = [
  'registration',
  'team_formation',
  'ideation',
  'development',
  'evaluation',
  'submission',
  'finale',
  'results',
] as const;
export type KnownPhaseName = (typeof PhaseNameValues)[number];
export type PhaseName = KnownPhaseName | string; // allow custom but validate known

export const ResourceVisibilityValues = ['PUBLIC', 'PARTICIPANT', 'MENTOR', 'ORGANIZER'] as const;
export type ResourceVisibility = (typeof ResourceVisibilityValues)[number];

export const ResourceTypeValues = ['DOCUMENT', 'LINK', 'API', 'DATASET', 'SDK', 'RULES', 'STARTER', 'OTHER'] as const;
export type ResourceType = (typeof ResourceTypeValues)[number];

export const FeedbackPublicationStatusValues = [
  'MENTOR_SUBMITTED',
  'ORGANIZER_REVIEWED',
  'PUBLISHED',
] as const;
export type FeedbackPublicationStatus = (typeof FeedbackPublicationStatusValues)[number];

export interface Hackathon {
  id: string;
  slug: string;
  title: string;
  description: string;
  hackathonType: HackathonType;
  objective: string;
  audience: string;
  duration: string;
  mode: HackathonMode;
  themeIds: string[];
  problemStatement?: string | null;
  constraints: string[];
  resources: string[]; // legacy freeform, but structured resources stored separately
  expectedOutcomes: string[];
  judgingPreferences: string[];
  rules: string[];
  status: HackathonStatus;
  organizerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  archivedAt?: string | null;
  // Canonical discovery windows (Unstop/Hack2Skill pattern).
  // Optional for backward-compat; derived from phases when absent.
  registrationStart?: string | null;
  registrationEnd?: string | null;
  eventStart?: string | null;
  eventEnd?: string | null;
  eligibility?: string[];
  teamSize?: { min: number; max: number; recommended?: number } | null;
  category?: string | null;
  tags?: string[];
  organizerName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface HackathonDraftInput {
  hackathonName: string;
  objective: string;
  audience: string;
  duration: string;
  mode: HackathonMode;
  themePreference: string;
  problemStatementBasedOrOpenInnovation: HackathonType;
  expectedOutcomes: string;
  judgingPreferences: string;
  resources: string;
  rules: string;
}

export interface HackathonDraft {
  title: string;
  description: string;
  hackathonType: HackathonType;
  objective: string;
  audience: string;
  duration: string;
  mode: HackathonMode;
  theme: string;
  problemStatement: string | null;
  constraints: string[];
  expectedOutcomes: string[];
  judgingCriteriaDraft: Array<{ name: string; description: string; weight: number }>;
  resourcesDraft: Array<{ title: string; type: ResourceType; url?: string }>;
  rulesDraft: string[];
  phasesDraft: Array<{ name: PhaseName; order: number; description: string }>;
  generatedAt: string;
  generatorVersion: string;
  // ---- Wizard automation (optional extended sections; never fabricated facts) ----
  tagline?: string;
  eligibility?: string[];
  teamSize?: { min: number; max: number; recommended?: number };
  problemStatements?: string[];
  openInnovation?: { guidelines: string[] };
  participationInstructions?: string;
  guidelines?: string[];
  codeOfConduct?: string[];
  faqs?: Array<{ question: string; answer: string }>;
  prizes?: Array<{ title: string; description: string }>;
  announcement?: string;
}

// ---- Quick-create wizard (organizer answers 5 questions; AI drafts the rest) ----
export const WizardEligibilityValues = ['Students', 'Developers', 'Designers', 'Professionals', 'Anyone'] as const;
export type WizardEligibility = (typeof WizardEligibilityValues)[number];

export interface WizardInput {
  mode: HackathonMode;
  about: string;
  hackathonType: HackathonType;
  eligibility: WizardEligibility[];
  customEligibility?: string;
  durationPlus: string;
}

export type SectionProvenance = 'AI_GENERATED' | 'ORGANIZER_EDITED' | 'AI_REGENERATED';

export const RegenerableSectionValues = [
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
] as const;
export type RegenerableSection = (typeof RegenerableSectionValues)[number];

// Themes
export interface Theme {
  id: string;
  name: string;
  description?: string | null;
  createdById: string;
  createdAt: string;
}

// Resources
export interface HackathonResource {
  id: string;
  hackathonId: string;
  title: string;
  type: ResourceType;
  url?: string | null;
  content?: string | null;
  visibility: ResourceVisibility;
  createdAt: string;
  updatedAt: string;
}

// Timeline Phase
export interface HackathonPhase {
  id: string;
  hackathonId: string;
  name: PhaseName;
  order: number;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
}

// Evaluation Criteria
export interface EvaluationCriteria {
  id: string;
  hackathonId: string;
  name: string;
  description?: string | null;
  weight: number;
  maxScore: number;
  createdAt: string;
  updatedAt: string;
}

// Mentor Assignment
export interface MentorAssignment {
  id: string;
  hackathonId: string;
  mentorId: string;
  teamId: string;
  assignedById: string;
  assignedAt: string;
}

// Mentor Feedback (Immutable with versioning)
export interface MentorFeedback {
  id: string;
  hackathonId: string;
  teamId: string;
  projectId?: string | null;
  mentorId: string;
  authorId: string;
  authorRole: Role;
  phase: string;
  score: number;
  remarks: string;
  reason: string;
  strengths: string[];
  weaknesses: string[];
  technicalFeedback: string | null;
  productFeedback: string | null;
  recommendation: string | null;
  version: number;
  parentId: string | null; // null for original, else points to previous version
  publicationStatus: FeedbackPublicationStatus;
  createdAt: string;
  updatedAt: string;
  isCorrection: boolean;
}

// Audit Log (append-only)
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: 'success' | 'failure';
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Published Event (Versioned Contract)
export interface HackathonPublishedEvent {
  eventId: string;
  version: 'v1';
  type: 'HackathonPublished';
  occurredAt: string;
  actorId: string | null;
  payload: {
    hackathonId: string;
    slug: string;
    title: string;
    description: string;
    hackathonType: HackathonType;
    objective: string;
    audience: string;
    mode: HackathonMode;
    themeIds: string[];
    problemStatement: string | null;
    constraints: string[];
    expectedOutcomes: string[];
    rules: string[];
    resources: Array<{
      id: string;
      title: string;
      type: string;
      url: string | null;
      visibility: string;
    }>;
    phases: Array<{ phaseId: string; name: string; startsAt: string; endsAt: string; order: number }>;
    judgingCriteria: Array<{ id: string; name: string; weight: number; maxScore: number }>;
    theme: string | null;
    announcements: string[];
    publishedAt: string;
    hackathonVersion: number;
    registrationStart?: string | null;
    registrationEnd?: string | null;
    eventStart?: string | null;
    eventEnd?: string | null;
    eligibility?: string[];
    teamSize?: { min: number; max: number; recommended?: number } | null;
    category?: string | null;
    tags?: string[];
    organizerName?: string | null;
    // Matches contracts HackathonPublished payload (optional, default OPTIONAL).
    repoRequirement?: 'REQUIRED' | 'OPTIONAL' | 'DISABLED';
  };
}

// Participants/Teams view (privacy boundaries)
export interface PublicParticipant {
  id: string;
  userId: string;
  displayName: string;
  hackathonId: string;
  teamId: string | null;
  participationStatus: string;
  joinedAt: string;
}

export interface PublicTeam {
  id: string;
  hackathonId: string;
  name: string;
  memberCount: number;
  members: Array<{ userId: string; displayName: string; role: string }>;
  project: { id: string; title: string; description: string } | null; // repoUrl hidden
  createdAt: string;
}

// Analytics
export interface OrganizerAnalytics {
  hackathonId: string;
  participantCount: number;
  teamCount: number;
  projectCount: number;
  phaseProgress: Array<{ phaseId: string; name: string; status: string; startsAt: string; endsAt: string }>;
  submissionStatus: { totalTeams: number; submitted: number; notSubmitted: number; submissionRate: number };
  evaluationStatus: { totalFeedbacks: number; published: number; pendingReview: number; unpublished: number };
  feedbackCompletion: { totalAssignments: number; completed: number; completionRate: number };
  generatedAt: string;
}

// Organizer Home command center — single-call aggregation over owned hackathons.
// All counts come from stored records; nullable fields mean "not knowable from
// existing data" (e.g. no capacity field exists) and must render as empty, never faked.
export interface OrganizerOverview {
  summary: {
    totalHackathons: number;
    activeHackathons: number;
    totalParticipants: number;
    totalTeams: number;
    projectsSubmitted: number;
    pendingEvaluations: number;
  };
  activeHackathon: null | {
    id: string;
    title: string;
    description: string;
    status: string;
    currentPhase: string | null;
    phases: Array<{ name: string; status: string }>;
    participantCount: number;
    teamCount: number;
    projectCount: number;
    mentorCount: number;
    registrationDeadline: string | null;
    teamFormationDeadline: string | null;
    submissionDeadline: string | null;
    evaluationDeadline: string | null;
  };
  registration: null | {
    total: number;
    today: number;
    thisWeek: number;
    capacity: null;
    remainingCapacity: null;
    deadline: string | null;
    progress: null;
  };
  teams: null | {
    total: number;
    complete: number | null;
    incomplete: number | null;
    participantsWithoutTeam: number;
    teamsWithoutSubmission: number;
  };
  submissions: null | {
    submitted: number;
    notSubmitted: number;
    deadline: string | null;
    rate: number;
  };
  evaluation: { total: number; published: number; pendingReview: number };
  feedback: { completed: number; totalAssignments: number; rate: number };
  attention: Array<{ kind: string; message: string; count: number; href: string }>;
  deadlines: Array<{ label: string; date: string; daysRemaining: number; href: string }>;
  recentActivity: Array<{ kind: string; message: string; at: string; href: string }>;
  trend: Array<{ day: string; teams: number; subs: number }>;
  hackathons: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    hackathonType: string;
    themeCount: number;
  }>;
  generatedAt: string;
}
