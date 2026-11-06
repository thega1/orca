import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockCreateTab, queuedStartups, store } from './launch-agent-in-new-tab-test-fixture'
import { CLAUDE_PINNED_ACCOUNT_ENV } from '../../../shared/claude-profile-routing'
import { getClaudeTabPinnedAccountId } from './claude-pinned-account-tabs'

afterEach(() => vi.restoreAllMocks())

describe('launchAgentInNewTab with a chosen Claude account', () => {
  it('starts a local Claude terminal pinned to the chosen account', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const result = launchAgentInNewTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      launchPlatform: 'linux',
      requestedSurface: 'terminal',
      claudeAccountId: 'personal'
    })
    expect(result?.surface.kind).toBe('local-terminal')
    const startup = queuedStartups()[0]
    expect(startup?.env?.[CLAUDE_PINNED_ACCOUNT_ENV]).toBe('personal')
    const tabId = result?.surface.kind === 'local-terminal' ? result.surface.tabId : ''
    expect(getClaudeTabPinnedAccountId(tabId)).toBe('personal')
  })

  it('refuses a chosen account where only the selected account can run', async () => {
    store.repos[0].connectionId = 'ssh-target-1'
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const result = launchAgentInNewTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      requestedSurface: 'terminal',
      claudeAccountId: 'personal'
    })
    expect(result).toBeNull()
    expect(mockCreateTab).not.toHaveBeenCalled()
  })
})
