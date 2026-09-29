import * as core from '@actions/core';
import { runPRCheck } from './modes/pr-check.js';
import { runRelease } from './modes/release.js';
import type { ActionInputs, TagPrefix } from './types.js';

/**
 * Parse and validate action inputs
 */
function getInputs(): ActionInputs {
  const mode = core.getInput('mode', { required: true });

  if (mode !== 'pr-check' && mode !== 'release') {
    throw new Error(`Invalid mode: "${mode}". Must be 'pr-check' or 'release'.`);
  }

  const githubToken = core.getInput('github-token');
  if (!githubToken) {
    throw new Error('github-token is required');
  }

  // Parse tag-prefix with validation
  const tagPrefixInput = core.getInput('tag-prefix') || 'contract';
  if (!['contract', 'v', 'none'].includes(tagPrefixInput)) {
    throw new Error(`Invalid tag-prefix: "${tagPrefixInput}". Must be 'contract', 'v', or 'none'.`);
  }

  return {
    mode,
    githubToken,
    anthropicApiKey: core.getInput('anthropic-api-key') || undefined,
    failOnBreaking: core.getInput('fail-on-breaking') === 'true',
    autoChangeset: core.getInput('auto-changeset') === 'true',
    versionPrTitle: core.getInput('version-pr-title') || 'chore: version contracts',
    versionPrBranch: core.getInput('version-pr-branch') || 'contractual/version-contracts',
    baseBranch: core.getInput('base-branch') || undefined,
    preReleaseTag: core.getInput('pre-release-tag') || undefined,
    createReleases: core.getInput('create-releases') !== 'false',
    tagPrefix: tagPrefixInput as TagPrefix,
    attachSpecs: core.getInput('attach-specs') !== 'false',
    syncVersion: core.getInput('sync-version') !== 'false',
  };
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs();

    core.debug(`Running in ${inputs.mode} mode`);

    switch (inputs.mode) {
      case 'pr-check':
        await runPRCheck(inputs);
        break;
      case 'release':
        await runRelease(inputs);
        break;
    }
  } catch (error) {
    if (error instanceof Error) {
      core.error(error.stack || error.message);
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

// Run and handle unhandled rejections
run().catch((error) => {
  core.setFailed(`Unhandled error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
