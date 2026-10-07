import * as core from '@actions/core';
import * as github from '@actions/github';
import { execFileSync, ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import type { VersionPROptions } from '../types.js';

/** Options for git commands */
const GIT_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
};

/**
 * Execute a git command with error handling
 */
function git(...args: string[]): string {
  try {
    const result = execFileSync('git', args, GIT_OPTIONS);
    return typeof result === 'string' ? result.trim() : '';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Git command failed: git ${args.join(' ')}\n${message}`);
  }
}

/**
 * Check if there are staged changes
 */
function hasStagedChanges(): boolean {
  try {
    git('diff', '--cached', '--quiet');
    return false; // No changes if command succeeds
  } catch {
    return true; // Changes exist if command fails
  }
}

/**
 * Create or update the Version Contracts PR.
 * - Creates a branch from the checked-out base
 * - Commits version changes
 * - Creates/updates PR
 */
export async function createOrUpdateVersionPR(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  options: VersionPROptions
): Promise<string> {
  const { owner, repo } = context.repo;
  const baseBranch = options.baseBranch || getDefaultBranch(context);

  core.debug(`Base branch: ${baseBranch}, Version branch: ${options.branch}`);

  if (options.branch === baseBranch) throw new Error('The version PR branch must differ from the base branch.');
  if (hasStagedChanges()) throw new Error('The index must be clean before creating a version PR.');
  if (!options.files.length) throw new Error('No version files were supplied.');
  git('check-ref-format', '--branch', options.branch);
  const remoteRef = `refs/heads/${options.branch}`;
  const previousSha = git('ls-remote', 'origin', remoteRef).split(/\s/)[0] || '';
  // Regenerate from the checked-out base. A lease prevents overwriting concurrent work.
  git('checkout', '-B', options.branch);

  // Configure git identity
  git('config', 'user.name', 'contractual[bot]');
  git('config', 'user.email', 'contractual[bot]@users.noreply.github.com');

  // Stage only version-owned paths
  git('add', '-A', '--', ...options.files);

  // Only commit if there are changes
  if (hasStagedChanges()) {
    git('commit', '-m', 'chore: version contracts');
    core.debug('Committed version changes');

    // Push changes
    git('push', `--force-with-lease=${remoteRef}:${previousSha}`, 'origin', `HEAD:${remoteRef}`);
    core.debug('Pushed changes');
  } else {
    core.info('No changes to commit');
  }

  // Find or create PR
  return await findOrCreatePR(octokit, owner, repo, options, baseBranch);
}

/**
 * Get default branch from context
 */
function getDefaultBranch(context: typeof github.context): string {
  const branch = context.payload.repository?.default_branch;
  if (typeof branch === 'string' && branch.length > 0) {
    return branch;
  }
  return 'next';
}

// Find existing PR or create a new one.
async function findOrCreatePR(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  options: VersionPROptions,
  baseBranch: string
): Promise<string> {
  // Find existing PR
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${options.branch}`,
    base: baseBranch,
    state: 'open',
  });

  if (prs.length > 0) {
    // Update existing PR body
    const pr = prs[0];
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      body: options.body,
      title: options.title,
    });
    core.info(`Updated existing PR #${pr.number}`);
    return pr.html_url;
  }

  // Create new PR
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: options.title,
    head: options.branch,
    base: baseBranch,
    body: options.body,
  });
  core.info(`Created PR #${pr.number}`);
  return pr.html_url;
}
