import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { checkVersionSync } from '../check-version-sync.mjs'

const testRoot = path.resolve('plugins/cli-dispatch/scripts/__tests__')
const tempDirs = new Set()

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

function makeFixtureRoot() {
  const dir = mkdtempSync(path.join(testRoot, 'tmp-version-sync-'))
  tempDirs.add(dir)
  return dir
}

function fixturePaths(rootDir) {
  return {
    rootDir,
    pluginJsonPath: path.join(rootDir, 'plugins', 'cli-dispatch', '.claude-plugin', 'plugin.json'),
    marketplaceJsonPath: path.join(rootDir, '.claude-plugin', 'marketplace.json'),
    changelogPath: path.join(rootDir, 'CHANGELOG.md'),
    changelogTrPath: path.join(rootDir, 'CHANGELOG.tr.md'),
  }
}

function writeFixture(rootDir, {
  pluginVersion = '1.2.3',
  metadataVersion = pluginVersion,
  marketplacePluginVersion = pluginVersion,
  changelogVersion = pluginVersion,
  changelogTrVersion = pluginVersion,
} = {}) {
  const paths = fixturePaths(rootDir)
  mkdirSync(path.dirname(paths.pluginJsonPath), { recursive: true })
  mkdirSync(path.dirname(paths.marketplaceJsonPath), { recursive: true })

  writeFileSync(paths.pluginJsonPath, JSON.stringify({
    name: 'cli-dispatch',
    version: pluginVersion,
  }, null, 2) + '\n')
  writeFileSync(paths.marketplaceJsonPath, JSON.stringify({
    metadata: { version: metadataVersion },
    plugins: [{ name: 'cli-dispatch', version: marketplacePluginVersion }],
  }, null, 2) + '\n')
  writeFileSync(paths.changelogPath, [
    '# Changelog',
    '',
    `## [${changelogVersion}] - 2026-07-06`,
    '',
  ].join('\n'))
  writeFileSync(paths.changelogTrPath, [
    '# Degisiklik Gunlugu',
    '',
    `## [${changelogTrVersion}] - 2026-07-06`,
    '',
  ].join('\n'))

  return paths
}

test('check-version-sync: matching fixture versions pass', () => {
  const rootDir = makeFixtureRoot()
  const paths = writeFixture(rootDir)

  const result = checkVersionSync(paths)

  assert.equal(result.ok, true)
  assert.equal(result.version, '1.2.3')
  assert.deepEqual(result.errors, [])
})

test('check-version-sync: reports marketplace metadata version mismatch', () => {
  const rootDir = makeFixtureRoot()
  const paths = writeFixture(rootDir, { metadataVersion: '1.2.4' })

  const result = checkVersionSync(paths)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /\.claude-plugin\/marketplace\.json metadata\.version is 1\.2\.4/)
  assert.match(result.errors.join('\n'), /plugins\/cli-dispatch\/\.claude-plugin\/plugin\.json version is 1\.2\.3/)
})

test('check-version-sync: reports changelog heading version mismatch', () => {
  const rootDir = makeFixtureRoot()
  const paths = writeFixture(rootDir, { changelogTrVersion: '1.2.2' })

  const result = checkVersionSync(paths)

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /CHANGELOG\.tr\.md topmost heading version is 1\.2\.2/)
  assert.match(result.errors.join('\n'), /plugins\/cli-dispatch\/\.claude-plugin\/plugin\.json version is 1\.2\.3/)
})
