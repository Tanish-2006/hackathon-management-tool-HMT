export interface FileMetadata {
  path: string;
  extension: string;
  module: string;
  imports: string[];
  exports: string[];
  classes: string[];
  functions: string[];
  routes: string[];
  endpoints: string[];
  packageNames: string[];
  symbols: string[];
  sizeChars: number;
  isBinary?: boolean;
  isGenerated?: boolean;
}

export interface RepositoryIndex {
  projectId?: string;
  files: FileMetadata[];
  readme: FileMetadata | null;
}

export interface RetrievalBudget {
  maxInitialFiles: number; // default 5
  maxExpansionRounds: number; // default 3
  maxSourceChars: number; // default 15000
  ignorePatterns: string[]; // binary, generated, deps, .git, build
}

export const DEFAULT_BUDGET: RetrievalBudget = {
  maxInitialFiles: 5,
  maxExpansionRounds: 3,
  maxSourceChars: 15000,
  ignorePatterns: [
    '\\.git/',
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '\\.next/',
    '\\.bin$',
    '\\.png$',
    '\\.jpg$',
    '\\.jpeg$',
    '\\.gif$',
    '\\.pdf$',
    '\\.zip$',
  ],
};

export interface RelevantFile {
  path: string;
  content: string; // redacted, truncated
  retrievalReason: string;
}

export interface TargetedRetrievalResult {
  question: string;
  projectContext: string;
  readmeContext: string | null;
  relevantFiles: RelevantFile[];
  retrievalReason: string;
  analysisScope: 'TARGETED';
  budgetUsed: {
    filesRetrieved: number;
    rounds: number;
    totalChars: number;
  };
  // For testing: ensure entire repo not sent
  entireRepositorySent: false;
}
