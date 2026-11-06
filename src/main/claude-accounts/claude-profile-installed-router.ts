import { join } from 'node:path'
import { isDirectory } from './claude-profile-homes'
// Keep the router setup graph out of scan workers.
import type { ClaudeProfileRouter } from './claude-profile-router'
import type { ClaudeWslProfileRouter } from './claude-profile-wsl-router'
import type { ClaudeAccountSelectionTarget } from './runtime-selection'
import type { ClaudeObservedConfigDirs } from './claude-observed-config-dirs'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import { readClaudePinnedAccountId } from '../../shared/claude-profile-routing'
import { pinnedClaudeTerminalEnv, preparePinnedClaudeLaunch } from './claude-profile-pinned-launch'

let installed: ClaudeProfileRouter | undefined

/** Installed only in the desktop process. */
export function installClaudeProfileRouter(router: ClaudeProfileRouter | undefined): void {
  installed = router
}

export function getClaudeProfileRouter(): ClaudeProfileRouter | undefined {
  return installed
}

let installedObserved: ClaudeObservedConfigDirs | undefined

export function installClaudeObservedConfigDirs(dirs: ClaudeObservedConfigDirs | undefined): void {
  installedObserved = dirs
}

export function getClaudeObservedConfigDirs(): ClaudeObservedConfigDirs | undefined {
  return installedObserved
}

let installedWsl: ClaudeWslProfileRouter | undefined

export function installClaudeWslProfileRouter(router: ClaudeWslProfileRouter | undefined): void {
  installedWsl = router
}

export function getClaudeWslProfileRouter(): ClaudeWslProfileRouter | undefined {
  return installedWsl
}

export function withClaudeProfileTerminalEnv<Env extends Record<string, string> | undefined>(
  env: Env,
  target: ClaudeAccountSelectionTarget
): Env | Record<string, string> {
  const pinned = pinnedHostAccountId(env, target)
  const profileEnv =
    (pinned !== null && installed ? pinnedClaudeTerminalEnv(installed, pinned) : null) ??
    installed?.terminalEnv(target)
  return profileEnv ? { ...env, ...profileEnv } : env
}

/** A launch pinned to a host account ("+" menu → Claude account); WSL panes keep their distro's routing. */
function pinnedHostAccountId(
  env: Record<string, string> | undefined,
  target: ClaudeAccountSelectionTarget | undefined
): string | null {
  if (target?.runtime === 'wsl') {
    return null
  }
  return readClaudePinnedAccountId(env)
}

/** Auth for a direct `claude` spawn pinned to an account; null keeps the selected account's auth. */
export async function preparePinnedClaudeLaunchAuth(
  env: Record<string, string> | undefined,
  target: ClaudeAccountSelectionTarget | undefined
): Promise<ClaudeRuntimeAuthPreparation | null> {
  const pinned = pinnedHostAccountId(env, target)
  return pinned !== null && installed ? preparePinnedClaudeLaunch(installed, pinned) : null
}

/** The user's CLAUDE_CONFIG_DIR from the login shell, folders Orca saw Claude use, and account homes. */
export function claudeProfileHistoryDirs(surface: 'projects' | 'transcripts'): string[] {
  const homes = [
    installed?.userConfigDir(),
    ...(installedObserved?.list() ?? []),
    ...(installed?.accountHomes() ?? [])
  ].filter((home): home is string => Boolean(home))
  const dirs = homes.map((home) => join(home, surface)).filter(isDirectory)
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index)
}
