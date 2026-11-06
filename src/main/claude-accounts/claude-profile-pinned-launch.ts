/** Claude launches pinned to one saved account ("+" menu → Claude on account): they run on that
 *  account's folder without changing the selected account, and keep it for a `claude` re-run. */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../shared/claude-profile-routing'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { prepareClaudeProfileForLaunch } from './claude-profile-launch-preparation'
import { readUserClaudeConfigDirAsSet, type ClaudeProfileDescriptor } from './claude-profile-paths'
import type { ClaudeProfileRouter } from './claude-profile-router'
import type { ClaudeProfileSetupReport } from './claude-profile-setup'
import type { ClaudeEnvPatch } from './environment'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

export type ClaudePinnedLaunchContext = {
  env: () => NodeJS.ProcessEnv
  envReady: Promise<unknown>
  describe: (accountId: string) => ClaudeProfileDescriptor
  setUp: (profile: ClaudeProfileDescriptor) => Promise<ClaudeProfileSetupReport>
  refreshWaitMs?: number
}

/** Where a pane pinned to `accountId` reads its account; the `claude` shell function re-reads it. */
function pinnedPointerPath(home: ClaudeProfileDescriptor): string {
  return join(dirname(home.home), 'pinned-pointer')
}

function writePinnedPointer(pointer: string, home: string): void {
  if (!existsSync(pointer) || readFileSync(pointer, 'utf8') !== home) {
    mkdirSync(dirname(pointer), { recursive: true, mode: 0o700 })
    writeFileAtomically(pointer, home, { mode: 0o600 })
  }
}

/** Host accounts only: a WSL account's folder lives in its distro, and unknown ids pin nothing. */
function isPinnable(router: ClaudeProfileRouter, accountId: string): boolean {
  const account = router.savedAccount(accountId)
  return Boolean(account) && account?.managedAuthRuntime !== 'wsl'
}

/** Terminal env for a pinned launch; null keeps the selected account's routing. */
export function pinnedClaudeTerminalEnv(
  router: ClaudeProfileRouter,
  accountId: string
): ClaudeEnvPatch | null {
  if (!isPinnable(router, accountId)) {
    return null
  }
  const context = router.pinnedLaunchContext()
  const profile = context.describe(accountId)
  // '' is System default, which already holds this account's login.
  const home = router.coveredBySystemDefault(accountId) ? '' : profile.home
  const pointer = pinnedPointerPath(profile)
  writePinnedPointer(pointer, home)
  const userConfigDir = readUserClaudeConfigDirAsSet(context.env())
  if (home) {
    // Refresh without delaying terminal creation, as the selected account's launches do.
    context.setUp(profile).catch((error: unknown) => {
      console.warn('[claude-profile] Pinned account setup failed:', error)
    })
  }
  return {
    [CLAUDE_PROFILE_POINTER_ENV]: pointer,
    ...(userConfigDir ? { [CLAUDE_USER_CONFIG_DIR_ENV]: userConfigDir } : {}),
    ...(home ? { CLAUDE_CONFIG_DIR: home, [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home } : {})
  }
}

/** A direct `claude` spawn pinned to an account: its folder must be set up, never swapped. */
export async function preparePinnedClaudeLaunch(
  router: ClaudeProfileRouter,
  accountId: string
): Promise<ClaudeRuntimeAuthPreparation | null> {
  if (!isPinnable(router, accountId)) {
    return null
  }
  const context = router.pinnedLaunchContext()
  await context.envReady
  const envPatch = pinnedClaudeTerminalEnv(router, accountId)
  if (!envPatch) {
    return null
  }
  const home = envPatch.CLAUDE_CONFIG_DIR
  if (home) {
    await prepareClaudeProfileForLaunch(
      context.describe(accountId),
      context.setUp,
      context.refreshWaitMs
    )
  }
  return {
    configDir: home ?? router.systemDefaultHome(),
    runtime: 'host',
    wslDistro: null,
    wslLinuxConfigDir: null,
    envPatch,
    provenance: home ? `profile:${accountId}` : 'system'
  }
}
