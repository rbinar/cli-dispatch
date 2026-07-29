#!/usr/bin/env node
// check-version-sync.mjs — verify duplicated release version metadata stays aligned.

import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = path.resolve(SELF_DIR, '../../..')

function defaultVersionSyncPaths(repoRoot = DEFAULT_REPO_ROOT) {
  return {
    rootDir: repoRoot,
    pluginJsonPath: path.join(repoRoot, 'plugins', 'cli-dispatch', '.claude-plugin', 'plugin.json'),
    marketplaceJsonPath: path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
    changelogPath: path.join(repoRoot, 'CHANGELOG.md'),
    changelogTrPath: path.join(repoRoot, 'CHANGELOG.tr.md'),
  }
}

function label(file, rootDir) {
  const rel = path.relative(rootDir, file)
  return rel && !rel.startsWith('..') ? rel : file
}

function readJson(file, rootDir, errors) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    errors.push(`Unable to read ${label(file, rootDir)}: ${err.message}`)
    return null
  }
}

function readChangelogVersion(file, rootDir, errors) {
  let contents
  try {
    contents = readFileSync(file, 'utf8')
  } catch (err) {
    errors.push(`Unable to read ${label(file, rootDir)}: ${err.message}`)
    return null
  }

  const match = /^##\s+\[([0-9]+\.[0-9]+\.[0-9]+)\](?:\s|$)/m.exec(contents)
  if (!match) {
    errors.push(`Unable to find a top-level version heading like "## [X.Y.Z]" in ${label(file, rootDir)}`)
    return null
  }
  return match[1]
}

function getString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function addMismatch(errors, actualFile, actualField, actualVersion, expectedFile, expectedField, expectedVersion, rootDir) {
  errors.push(
    `Version mismatch: ${label(actualFile, rootDir)} ${actualField} is ${actualVersion ?? '<missing>'}, ` +
    `but ${label(expectedFile, rootDir)} ${expectedField} is ${expectedVersion ?? '<missing>'}.`
  )
}

export function checkVersionSync(paths = {}) {
  const {
    rootDir,
    pluginJsonPath,
    marketplaceJsonPath,
    changelogPath,
    changelogTrPath,
  } = { ...defaultVersionSyncPaths(), ...paths }

  const errors = []
  const pluginJson = readJson(pluginJsonPath, rootDir, errors)
  const marketplaceJson = readJson(marketplaceJsonPath, rootDir, errors)
  if (!pluginJson || !marketplaceJson) {
    return { ok: false, version: null, errors }
  }

  const pluginVersion = getString(pluginJson.version)
  const metadataVersion = getString(marketplaceJson.metadata?.version)
  const marketplacePluginVersion = getString(marketplaceJson.plugins?.[0]?.version)

  if (!pluginVersion) {
    errors.push(`Unable to find version in ${label(pluginJsonPath, rootDir)}`)
  }
  if (!metadataVersion) {
    errors.push(`Unable to find metadata.version in ${label(marketplaceJsonPath, rootDir)}`)
  }
  if (!marketplacePluginVersion) {
    errors.push(`Unable to find plugins[0].version in ${label(marketplaceJsonPath, rootDir)}`)
  }

  if (pluginVersion && metadataVersion && metadataVersion !== pluginVersion) {
    addMismatch(
      errors,
      marketplaceJsonPath, 'metadata.version', metadataVersion,
      pluginJsonPath, 'version', pluginVersion,
      rootDir
    )
  }
  if (pluginVersion && marketplacePluginVersion && marketplacePluginVersion !== pluginVersion) {
    addMismatch(
      errors,
      marketplaceJsonPath, 'plugins[0].version', marketplacePluginVersion,
      pluginJsonPath, 'version', pluginVersion,
      rootDir
    )
  }

  const changelogVersion = readChangelogVersion(changelogPath, rootDir, errors)
  const changelogTrVersion = readChangelogVersion(changelogTrPath, rootDir, errors)

  if (pluginVersion && changelogVersion && changelogVersion !== pluginVersion) {
    addMismatch(
      errors,
      changelogPath, 'topmost heading version', changelogVersion,
      pluginJsonPath, 'version', pluginVersion,
      rootDir
    )
  }
  if (pluginVersion && changelogTrVersion && changelogTrVersion !== pluginVersion) {
    addMismatch(
      errors,
      changelogTrPath, 'topmost heading version', changelogTrVersion,
      pluginJsonPath, 'version', pluginVersion,
      rootDir
    )
  }

  return { ok: errors.length === 0, version: pluginVersion, errors }
}

function runVersionSyncCli(paths = {}) {
  const result = checkVersionSync(paths)
  if (result.ok) {
    console.log(`✓ version sync OK (${result.version})`)
  } else {
    for (const error of result.errors) {
      console.error(error)
    }
  }
  return result
}

const entryPath = process.argv[1]
let entryRealPath = entryPath
try { entryRealPath = realpathSync(entryPath) } catch {}
if (entryPath && import.meta.url === pathToFileURL(entryRealPath).href) {
  const result = runVersionSyncCli()
  process.exit(result.ok ? 0 : 1)
}
