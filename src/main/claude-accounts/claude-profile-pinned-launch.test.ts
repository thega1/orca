import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PINNED_ACCOUNT_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  readClaudePinnedAccountId
} from '../../shared/claude-profile-routing'
import { getPosixClaudeShellFunction } from '../../shared/claude-shell-function'
import { claudeProfileMarkerPath, type ClaudeProfileDescriptor } from './claude-profile-paths'
import type { ClaudeProfileSetupReport } from './claude-profile-setup'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'
import {
  installClaudeProfileRouter,
  preparePinnedClaudeLaunchAuth,
  withClaudeProfileTerminalEnv
} from './claude-profile-installed-router'

vi.mock('@orca/process-host', () => ({ runProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => '/unused-claude' }))
vi.mock('../startup/login-shell-environment', () => ({
  resolveLoginShellEnvironment: () => Promise.resolve({})
}))

const roots: string[] = []
afterEach(() => {
  installClaudeProfileRouter(undefined)
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function account(id: string, extra: Partial<ClaudeManagedAccount> = {}): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.test`,
    authMethod: 'subscription-oauth',
    managedAuthPath: '/unused-legacy',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...extra
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-pinned-'))
  roots.push(root)
  const userHome = join(root, 'personal')
  const dataRoot = join(root, 'data')
  mkdirSync(join(userHome, '.claude'), { recursive: true })
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: [
      account('work'),
      account('personal'),
      account('guest', { managedAuthRuntime: 'wsl' })
    ],
    activeClaudeManagedAccountId: 'work',
    activeClaudeManagedAccountIdsByRuntime: undefined,
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  const runSetup = async ({
    profile
  }: {
    profile: ClaudeProfileDescriptor
  }): Promise<ClaudeProfileSetupReport> => {
    mkdirSync(profile.home, { recursive: true })
    writeFileSync(claudeProfileMarkerPath(profile), '{}')
    return { outcome: 'prepared', warnings: [], surfaces: {} }
  }
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot,
    userHome,
    env: {},
    runSetup,
    refreshWaitMs: 50
  })
  installClaudeProfileRouter(router)
  const home = (id: string) => join(dataRoot, 'claude-profiles', id, 'home')
  // The selected account's folder exists, as it does once it has been set up.
  mkdirSync(home('work'), { recursive: true })
  return { root, router, home }
}

function pinnedTo(accountId: string): Record<string, string> {
  return { [CLAUDE_PINNED_ACCOUNT_ENV]: accountId }
}

function runClaudeIn(root: string, env: Record<string, string>): string {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf "%s" "${CLAUDE_CONFIG_DIR-unset}"\n')
  chmodSync(join(bin, 'claude'), 0o700)
  return spawnSync(
    '/bin/bash',
    ['--norc', '--noprofile', '-c', `${getPosixClaudeShellFunction()}\nclaude`],
    { env: { ...env, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' }
  ).stdout
}

describe('Claude launches pinned to a chosen account', () => {
  it('reads only plain account ids from the launch env', () => {
    expect(readClaudePinnedAccountId({ [CLAUDE_PINNED_ACCOUNT_ENV]: 'abc-123_x' })).toBe(
      'abc-123_x'
    )
    expect(readClaudePinnedAccountId({ [CLAUDE_PINNED_ACCOUNT_ENV]: '../other' })).toBeNull()
    expect(readClaudePinnedAccountId({})).toBeNull()
    expect(readClaudePinnedAccountId(undefined)).toBeNull()
  })

  it('routes a pinned terminal to its account while the selected account stays in place', () => {
    const { root, home } = fixture()
    const env = withClaudeProfileTerminalEnv(pinnedTo('personal'), { runtime: 'host' })
    expect(env.CLAUDE_CONFIG_DIR).toBe(home('personal'))
    expect(env[CLAUDE_INJECTED_CONFIG_DIR_ENV]).toBe(home('personal'))
    const pointer = env[CLAUDE_PROFILE_POINTER_ENV]
    expect(readFileSync(pointer, 'utf8')).toBe(home('personal'))
    // A `claude` typed again in that pane re-reads its own pointer, not the selected account's.
    expect(runClaudeIn(root, env)).toBe(home('personal'))
    const noPin: Record<string, string> = {}
    const unpinned = withClaudeProfileTerminalEnv(noPin, { runtime: 'host' })
    expect(unpinned.CLAUDE_CONFIG_DIR).toBe(home('work'))
    expect(unpinned[CLAUDE_PROFILE_POINTER_ENV]).not.toBe(pointer)
  })

  it('keeps the selected routing for unknown or WSL accounts', () => {
    const { home } = fixture()
    for (const id of ['missing', 'guest']) {
      const env = withClaudeProfileTerminalEnv(pinnedTo(id), { runtime: 'host' })
      expect(env.CLAUDE_CONFIG_DIR).toBe(home('work'))
    }
  })

  it('prepares a direct claude spawn on the pinned account', async () => {
    const { home } = fixture()
    const auth = await preparePinnedClaudeLaunchAuth(
      { [CLAUDE_PINNED_ACCOUNT_ENV]: 'personal' },
      { runtime: 'host' }
    )
    expect(auth?.configDir).toBe(resolve(home('personal')))
    expect(auth?.envPatch.CLAUDE_CONFIG_DIR).toBe(home('personal'))
    expect(auth?.provenance).toBe('profile:personal')
    expect(await preparePinnedClaudeLaunchAuth({}, { runtime: 'host' })).toBeNull()
    expect(
      await preparePinnedClaudeLaunchAuth(
        { [CLAUDE_PINNED_ACCOUNT_ENV]: 'personal' },
        { runtime: 'wsl', wslDistro: 'Ubuntu' }
      )
    ).toBeNull()
  })
})
