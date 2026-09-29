/**
 * Action-specific types
 * Re-exports types from @contractual/cli and adds action-specific types
 */

import type {
  LintResult,
  LintIssue,
  DiffResult,
  DiffOptions,
  DiffContractsResult,
  Change,
  ChangeSeverity,
  DiffSummary,
  SuggestedBump,
  BumpResult,
  BumpType,
  ChangesetFile,
  ResolvedConfig,
  ResolvedContract,
} from '@contractual/cli';

// Re-export types from CLI for convenience
export type {
  LintResult,
  LintIssue,
  DiffResult,
  DiffOptions,
  DiffContractsResult,
  Change,
  ChangeSeverity,
  DiffSummary,
  SuggestedBump,
  BumpResult,
  BumpType,
  ChangesetFile,
  ResolvedConfig,
  ResolvedContract,
};

/**
 * Data for rendering PR comment
 */
export interface PRCommentData {
  /** Results from lint command */
  lintResults: LintResult[];
  /** Results from breaking command */
  diffResults: DiffResult[];
  /** Whether a changeset already exists in the PR */
  hasChangeset: boolean;
  /** Whether a changeset was auto-created in this run */
  changesetCreated: boolean;
  /** AI-generated explanation (null if no API key) */
  aiExplanation: string | null;
}

/**
 * Data for rendering Version PR body
 */
export interface VersionPRData {
  /** Version bumps to be applied */
  bumps: BumpResult[];
  /** Changesets that will be consumed */
  consumedChangesets: string[];
}

/**
 * Options for creating/updating Version PR
 */
export interface VersionPROptions {
  /** Exact repository-relative paths owned by versioning */
  files: string[];
  /** Branch name for the PR */
  branch: string;
  /** PR title */
  title: string;
  /** PR body markdown */
  body: string;
  /** Base branch to target (optional, defaults to repository default branch) */
  baseBranch?: string;
}

/**
 * Changeset file to commit
 */
export interface ChangesetToCommit {
  /** Filename (without path) */
  filename: string;
  /** File content */
  content: string;
}

/**
 * Tag prefix format for releases
 */
export type TagPrefix = 'contract' | 'v' | 'none';

/**
 * Action inputs from action.yml
 */
export interface ActionInputs {
  mode: 'pr-check' | 'release';
  githubToken: string;
  anthropicApiKey?: string;
  failOnBreaking: boolean;
  autoChangeset: boolean;
  versionPrTitle: string;
  versionPrBranch: string;
  baseBranch?: string;
  preReleaseTag?: string;
  createReleases: boolean;
  tagPrefix: TagPrefix;
  attachSpecs: boolean;
  syncVersion: boolean;
}
