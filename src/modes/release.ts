import * as core from '@actions/core';
import * as github from '@actions/github';
import { existsSync, unlinkSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import {
  loadConfig,
  readChangesets,
  VersionManager,
  aggregateBumps,
  extractContractChanges,
  appendChangelog,
  findContractualDir,
  incrementVersion,
  incrementVersionWithPreRelease,
  updateSpecVersion,
  CHANGESETS_DIR,
} from '@contractual/cli';
import type { BumpResult } from '@contractual/cli';
import { createOrUpdateVersionPR } from '../github/pull-requests.js';
import {
  createGitTag,
  createRelease,
  uploadReleaseAsset,
  formatTag,
  isPrerelease,
  tagExists,
} from '../github/releases.js';
import { renderVersionPRBody } from '../render/version-pr.js';
import { renderReleaseNotes } from '../render/release-notes.js';
import { extractChangelogSection } from '../lib/changelog.js';
import type { ActionInputs, ChangesetFile, ResolvedConfig } from '../types.js';

/**
 * Run the release workflow:
 * - If changesets exist: run version, create/update Version PR
 * - If no changesets + version merge: run post-release hooks
 */
export async function runRelease(inputs: ActionInputs): Promise<void> {
  const octokit = github.getOctokit(inputs.githubToken);
  const context = github.context;

  const baseBranch = inputs.baseBranch || context.payload.repository?.default_branch || 'next';
  if (!['push', 'workflow_dispatch'].includes(context.eventName) || context.ref !== `refs/heads/${baseBranch}`) {
    throw new Error(`Release mode must run on a push or manual run on ${baseBranch}.`);
  }

  core.info('Loading contractual config...');
  const config = loadConfig(); // sync function
  if (config.versioning?.mode === 'fixed') throw new Error('Fixed versioning is not implemented. Use independent versioning.');
  if (inputs.tagPrefix !== 'contract' && config.contracts.length > 1) {
    throw new Error('Multiple contracts require tag-prefix: contract to avoid tag collisions.');
  }

  core.info('Reading changesets...');
  const changesets = await readChangesets(join(config.configDir, '.contractual/changesets'));

  if (changesets.length > 0) {
    core.info(`Found ${changesets.length} changeset(s). Running version workflow...`);
    await handleVersioning(octokit, context, config, changesets, inputs);
  } else {
    core.info('No changesets found. Checking if this is a version merge...');
    const versionMergeInfo = await checkIfVersionMerge(octokit, context, config);
    if (versionMergeInfo) {
      core.info('Version merge detected. Running post-release...');
      await handlePostRelease(octokit, context, config, versionMergeInfo, inputs);
    } else {
      core.info('Not a version merge. Nothing to do.');
    }
  }
}

/**
 * Handle versioning when changesets exist
 */
async function handleVersioning(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  config: ResolvedConfig,
  changesets: ChangesetFile[],
  inputs: ActionInputs
): Promise<void> {
  const contractualDir = findContractualDir(config.configDir);
  if (!contractualDir) {
    throw new Error('No .contractual directory found');
  }

  // Aggregate bumps (highest wins per contract)
  const aggregatedBumps = aggregateBumps(changesets);
  const unknown = Object.keys(aggregatedBumps).filter(name => !config.contracts.some(c => c.name === name));
  if (unknown.length) throw new Error(`Unknown contracts in changesets: ${unknown.join(', ')}. No changesets were consumed.`);

  // Initialize version manager
  const versionManager = new VersionManager(contractualDir);

  // Process each contract bump
  const bumpResults: BumpResult[] = [];
  const consumedChangesets: string[] = [];

  for (const [contractName, bumpType] of Object.entries(aggregatedBumps)) {
    const contract = config.contracts.find((c) => c.name === contractName);
    if (!contract) {
      core.warning(`Contract "${contractName}" not found in config, skipping.`);
      continue;
    }

    let oldVersion: string;
    let newVersion: string;

    const shouldSyncVersion = inputs.syncVersion && contract.syncVersion !== false;

    if (inputs.preReleaseTag) {
      // Pre-release mode: calculate version with tag and use setVersion
      oldVersion = versionManager.getVersion(contractName) ?? '0.0.0';
      newVersion = incrementVersionWithPreRelease(oldVersion, bumpType, inputs.preReleaseTag);
      if (shouldSyncVersion) {
        updateSpecVersion(contract.absolutePath, newVersion, contract.type);
      }
      versionManager.setVersion(contractName, newVersion, contract.absolutePath);
    } else {
      // Normal mode: compute version first, update spec, then bump (snapshot includes updated version)
      oldVersion = versionManager.getVersion(contractName) ?? '0.0.0';
      newVersion = incrementVersion(oldVersion, bumpType);
      if (shouldSyncVersion) {
        updateSpecVersion(contract.absolutePath, newVersion, contract.type);
      }
      versionManager.bump(contractName, bumpType, contract.absolutePath);
    }

    // Extract changes text from changesets
    const changes = extractContractChanges(changesets, contractName);

    bumpResults.push({
      contract: contractName,
      oldVersion,
      newVersion,
      bumpType,
      changes,
    });

    const tagSuffix = inputs.preReleaseTag ? ` [${inputs.preReleaseTag}]` : '';
    core.info(`Bumped ${contractName}: ${oldVersion} → ${newVersion} (${bumpType})${tagSuffix}`);
  }

  // Append to CHANGELOG.md
  const changelogPath = join(config.configDir, 'CHANGELOG.md');
  appendChangelog(changelogPath, bumpResults);
  core.info('Updated CHANGELOG.md');

  // Delete consumed changeset files
  const changesetsDir = join(contractualDir, CHANGESETS_DIR);
  for (const changeset of changesets) {
    const changesetPath = join(changesetsDir, changeset.filename);
    unlinkSync(changesetPath);
    consumedChangesets.push(changeset.filename);
    core.debug(`Deleted changeset: ${changeset.filename}`);
  }

  // Set bumped-versions output
  const bumpedVersions: Record<string, string> = {};
  for (const bump of bumpResults) {
    bumpedVersions[bump.contract] = bump.newVersion;
  }
  core.setOutput('bumped-versions', JSON.stringify(bumpedVersions));

  // Render PR body
  const prBody = renderVersionPRBody({
    bumps: bumpResults,
    consumedChangesets,
  });

  try {
    const prUrl = await createOrUpdateVersionPR(octokit, context, {
      branch: inputs.versionPrBranch,
      title: inputs.versionPrTitle,
      body: prBody,
      baseBranch: inputs.baseBranch,
      files: [contractualDir, changelogPath, ...config.contracts.map(c => c.absolutePath)]
        .filter(path => existsSync(path))
        .map(path => relative(process.cwd(), path)),
    });

    core.setOutput('version-pr-url', prUrl);
    core.info(`Version Contracts PR: ${prUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to create Version PR: ${message}`);
  }
}

/**
 * Information about a version merge commit
 */
interface VersionMergeInfo {
  /** Contracts that were bumped with their old and new versions */
  bumps: Array<{
    contract: string;
    oldVersion: string;
    newVersion: string;
  }>;
}

/**
 * Handle post-release when Version PR was merged
 * Creates git tags and GitHub Releases for each bumped contract
 */
async function handlePostRelease(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  config: ResolvedConfig,
  mergeInfo: VersionMergeInfo,
  inputs: ActionInputs
): Promise<void> {
  const contractualDir = findContractualDir(config.configDir);
  if (!contractualDir) {
    throw new Error('No .contractual directory found');
  }

  const versionManager = new VersionManager(contractualDir);
  const createdTags: string[] = [];
  const releaseUrls: string[] = [];
  const failures: string[] = [];

  for (const bump of mergeInfo.bumps) {
    const { contract: contractName, oldVersion, newVersion } = bump;

    // Find contract config
    const contract = config.contracts.find((c) => c.name === contractName);
    if (!contract) throw new Error(`Cannot release unknown contract: ${contractName}`);

    // Format tag name
    const tagName = formatTag(contractName, newVersion, inputs.tagPrefix);

    // Check if tag already exists (idempotency)
    // Create git tag
    try {
      if (!(await tagExists(octokit, context, tagName))) {
        await createGitTag(tagName, `Release ${contractName} ${newVersion}`, context.sha);
        createdTags.push(tagName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      core.warning(`Failed to create tag ${tagName}: ${message}`);
      failures.push(`${tagName}: ${message}`);
      continue;
    }

    // Create GitHub Release
    if (inputs.createReleases) {
      try {
        // Extract changelog section for this version
        const changes = extractChangelogSection(contractName, newVersion, join(config.configDir, 'CHANGELOG.md'));

        const releaseNotes = renderReleaseNotes({
          contractName,
          oldVersion,
          newVersion,
          changes,
          bumpType: detectBumpType(oldVersion, newVersion),
        });

        const release = await createRelease(octokit, context, {
          tagName,
          releaseName: `${contractName} v${newVersion}`,
          body: releaseNotes,
          prerelease: isPrerelease(newVersion),
        });

        releaseUrls.push(release.url);

        // Attach spec file as asset
        if (inputs.attachSpecs && contract) {
          const snapshotPath = versionManager.getSnapshotPath(contractName);
          if (!snapshotPath || !existsSync(snapshotPath)) {
            throw new Error(`Missing release snapshot for ${contractName}`);
          }
          if (snapshotPath && existsSync(snapshotPath)) {
            const ext = extname(snapshotPath);
            const assetName = `${contractName}-${newVersion}${ext}`;

            try {
              await uploadReleaseAsset(octokit, context, release.id, {
                name: assetName,
                path: snapshotPath,
              });
              core.info(`Attached spec: ${assetName}`);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              core.warning(`Failed to attach spec ${assetName}: ${message}`);
              failures.push(`${assetName}: ${message}`);
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        core.warning(`Failed to create release for ${tagName}: ${message}`);
        failures.push(`${tagName}: ${message}`);
      }
    }
  }

  // Set outputs
  core.setOutput('created-tags', JSON.stringify(createdTags));
  core.setOutput('release-urls', JSON.stringify(releaseUrls));
  if (failures.length) throw new Error(`Release incomplete; rerun to resume: ${failures.join('; ')}`);

  core.info(`Created ${createdTags.length} tag(s) and ${releaseUrls.length} release(s)`);
}

/**
 * Detect bump type by comparing versions
 */
function detectBumpType(oldVersion: string, newVersion: string): 'major' | 'minor' | 'patch' {
  const oldParts = oldVersion.split('.').map((p) => parseInt(p.split('-')[0], 10));
  const newParts = newVersion.split('.').map((p) => parseInt(p.split('-')[0], 10));

  if (newParts[0] > oldParts[0]) return 'major';
  if (newParts[1] > oldParts[1]) return 'minor';
  return 'patch';
}

/**
 * Check if current commit is a version merge (modified versions.json)
 * Returns bump information if it is, null otherwise
 */
async function checkIfVersionMerge(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  config: ResolvedConfig
): Promise<VersionMergeInfo | null> {
  const versionsPath = relative(process.cwd(), join(config.configDir, '.contractual/versions.json')).replaceAll('\\', '/');
  try {
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.sha,
    });

    // Compare contents directly: commit.files is paginated and may omit versions.json.

    // Get the current versions.json content
    const { data: currentContent } = await octokit.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: versionsPath,
      ref: context.sha,
    });

    // Get the parent commit's versions.json content
    const parentSha = commit.parents?.[0]?.sha;
    let previousVersions: Record<string, { version: string }> = {};

    if (parentSha) {
      try {
        const { data: previousContent } = await octokit.rest.repos.getContent({
          owner: context.repo.owner,
          repo: context.repo.repo,
          path: versionsPath,
          ref: parentSha,
        });

        if ('content' in previousContent) {
          const decoded = Buffer.from(previousContent.content, 'base64').toString('utf-8');
          previousVersions = JSON.parse(decoded);
        }
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        // Parent might not have versions.json (first version)
        core.debug('Could not read parent versions.json - assuming first release');
      }
    }

    // Parse current versions
    let currentVersions: Record<string, { version: string }> = {};
    if ('content' in currentContent) {
      const decoded = Buffer.from(currentContent.content, 'base64').toString('utf-8');
      currentVersions = JSON.parse(decoded);
    }

    // Calculate bumps by comparing versions
    const bumps: VersionMergeInfo['bumps'] = [];

    for (const [contractName, entry] of Object.entries(currentVersions)) {
      const currentVersion = entry.version;
      const previousVersion = previousVersions[contractName]?.version ?? '0.0.0';

      if (currentVersion !== previousVersion) {
        bumps.push({
          contract: contractName,
          oldVersion: previousVersion,
          newVersion: currentVersion,
        });
        core.info(`Detected bump: ${contractName} ${previousVersion} → ${currentVersion}`);
      }
    }

    if (bumps.length === 0) {
      core.debug('versions.json modified but no version changes detected');
      return null;
    }

    return { bumps };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if ((error as { status?: number }).status === 404) return null;
    throw new Error(`Failed to check if version merge: ${message}`);
  }
}
