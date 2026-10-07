import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  loadConfig,
  getLinter,
  getDiffer,
  diffContracts,
  readChangesets,
  aggregateBumps,
  createChangeset as cliCreateChangeset,
} from '@contractual/cli';
import { join, relative } from 'node:path';
import { postOrUpdateComment } from '../github/comments.js';
import { commitChangeset } from '../github/commits.js';
import { renderPRComment } from '../render/pr-comment.js';
import type { ActionInputs, LintResult, DiffResult, ResolvedConfig } from '../types.js';

/**
 * Run the PR check workflow:
 * 1. Load config
 * 2. Run lint
 * 3. Run breaking
 * 4. Check for existing changeset
 * 5. Auto-generate changeset if missing
 * 6. Render and post PR comment
 * 7. Set outputs
 * 8. Fail if breaking + fail-on-breaking
 */
export async function runPRCheck(inputs: ActionInputs): Promise<void> {
  const octokit = github.getOctokit(inputs.githubToken);
  const context = github.context;
  const prNumber = context.payload.pull_request?.number;

  if (!prNumber) {
    throw new Error('This action must run on pull_request events');
  }

  core.info('Loading contractual config...');
  const config = loadConfig();

  // Run lint
  core.info('Running lint...');
  const lintResults = await runLint(config);
  const hasLintErrors = lintResults.some((r) => r.errors.length > 0);
  core.info(`Lint complete: ${lintResults.length} contract(s) checked`);

  // Run diff (includes breaking, non-breaking, and patch changes)
  core.info('Running diff/breaking change detection...');
  const diffResults = await runDiff(config);
  const hasBreaking = diffResults.some((r) => r.summary.breaking > 0);
  const hasChanges = diffResults.some((r) => r.changes.length > 0);
  core.info(`Breaking detection complete: ${hasBreaking ? 'breaking changes found' : 'no breaking changes'}`);

  // Check for existing changeset in PR
  core.info('Checking for existing changeset...');
  const prFiles = await getPRFiles(octokit, context, prNumber);
  const changesetsDir = join(config.configDir, '.contractual/changesets');
  const changedPaths = new Set(prFiles.filter(f => f.status !== 'removed').map(f => f.filename));
  const changesets = (await readChangesets(changesetsDir)).filter(cs =>
    changedPaths.has(relative(process.cwd(), join(changesetsDir, cs.filename)).replaceAll('\\', '/'))
  );
  const bumps = aggregateBumps(changesets);
  const unknownContracts = Object.keys(bumps).filter(name => !config.contracts.some(c => c.name === name));
  if (unknownContracts.length) throw new Error(`Changesets reference unknown contracts: ${unknownContracts.join(', ')}`);
  const priorities = { none: 0, patch: 1, minor: 2, major: 3 };
  const uncovered = diffResults.filter(result => result.changes.length > 0 &&
    priorities[bumps[result.contract] || 'none'] < priorities[result.suggestedBump]);
  const hasChangeset = hasChanges && uncovered.length === 0;

  // Auto-generate changeset if missing
  let changesetCreated = false;
  const isFork = context.payload.pull_request?.head.repo?.full_name !== context.payload.repository?.full_name;
  if (hasChanges && !hasChangeset && inputs.autoChangeset && !isFork) {
    core.info('Auto-generating changeset...');
    try {
      const changesetFile = generateChangeset(uncovered);
      if (changesetFile) {
        await commitChangeset(changesetFile);
        changesetCreated = true;
        core.info(`Changeset committed: ${changesetFile.filename}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      core.warning(`Failed to auto-generate changeset: ${message}`);
    }
  }

  // Render and post PR comment
  core.info('Posting PR comment...');
  const commentBody = renderPRComment({
    lintResults,
    diffResults,
    hasChangeset: hasChangeset || changesetCreated,
    changesetCreated,
    aiExplanation: null, // LLM integration deferred
  });

  try {
    await postOrUpdateComment(octokit, context, prNumber, commentBody);
    core.info('PR comment posted');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    core.warning(`Failed to post PR comment: ${message}`);
  }

  // Set outputs
  core.setOutput('has-breaking', hasBreaking.toString());
  core.setOutput('has-changes', hasChanges.toString());
  core.setOutput('changeset-created', changesetCreated.toString());

  // Fail if configured
  if (hasLintErrors) {
    core.setFailed('Lint errors found. Review the PR comment for details.');
    return;
  }

  if (hasChanges && !hasChangeset && !changesetCreated && config.changeset?.requireOnPR !== false) {
    core.setFailed('A changeset covering every changed contract with a sufficient version bump is required.');
    return;
  }

  if (hasBreaking && inputs.failOnBreaking) {
    core.setFailed('Breaking changes detected. Review the PR comment for details.');
  }
}

/**
 * Run lint for all contracts in config
 */
async function runLint(config: ResolvedConfig): Promise<LintResult[]> {
  const results: LintResult[] = [];

  for (const contract of config.contracts) {
    // Skip if linting disabled
    if (contract.lint === false) {
      core.debug(`Skipping lint for ${contract.name} (disabled)`);
      continue;
    }

    try {
      const linter = getLinter(contract.type, contract.lint);

      if (!linter) {
        throw new Error(`No linter available for ${contract.type}. Configure a custom lint command or set lint: false.`);
      }

      const result = await linter(contract.absolutePath);
      results.push({
        ...result,
        contract: contract.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Linter failed';
      results.push({
        contract: contract.name,
        specPath: contract.absolutePath,
        errors: [{ path: '', message, severity: 'error' }],
        warnings: [],
      });
    }
  }

  return results;
}

/**
 * Run diff for all contracts - returns ALL classified changes.
 * This is the primitive used by both `diff` and `breaking` CLI commands.
 * The action decides separately whether to fail based on inputs.failOnBreaking.
 */
async function runDiff(config: ResolvedConfig): Promise<DiffResult[]> {
  for (const contract of config.contracts) {
    if (contract.breaking !== false && !getDiffer(contract.type, contract.breaking)) {
      throw new Error(`No differ available for ${contract.type}. Configure a custom breaking command or set breaking: false.`);
    }
  }
  const { results } = await diffContracts(config, { includeEmpty: false });
  return results;
}

/**
 * Generate changeset from diff results
 */
function generateChangeset(
  diffResults: DiffResult[]
): { filename: string; content: string } | null {
  // Filter to only contracts with changes
  const resultsWithChanges = diffResults.filter((r) => r.changes.length > 0);

  if (resultsWithChanges.length === 0) {
    return null;
  }

  return cliCreateChangeset(resultsWithChanges);
}

/**
 * Get list of files changed in PR
 */
async function getPRFiles(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  prNumber: number
): Promise<Array<{ filename: string; status: string }>> {
  return await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });
}
