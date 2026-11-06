import React from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { AgentIcon } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import type { NewTabAgentMenuModel } from './new-tab-agent-menu-model'

const EMPTY_ACCOUNTS: readonly ClaudeManagedAccount[] = []

/** Claude can start in a terminal here: the "+" menu lists it as a terminal agent. */
function launchesClaudeTerminal(model: NewTabAgentMenuModel): boolean {
  return (
    model.state === 'settled' &&
    model.rows.some(
      (row) => row.agent === 'claude' && (row.kind === 'cli' || row.kind === 'terminal')
    )
  )
}

function accountDetail(account: ClaudeManagedAccount): string | null {
  return account.organizationName?.trim() || null
}

/**
 * "+" menu → "Claude on account ▸": start a Claude terminal on a saved account without switching
 * the selected one. Other tabs, and later launches, keep using the selected account.
 */
export function ClaudeAccountLaunchSubmenu({
  agentMenu,
  worktreeId,
  groupId,
  onFocusTerminal
}: {
  agentMenu: NewTabAgentMenuModel
  worktreeId: string
  groupId: string
  onFocusTerminal: (tabId: string) => void
}): React.JSX.Element | null {
  const accounts = useAppStore((s) => s.settings?.claudeManagedAccounts ?? EMPTY_ACCOUNTS)
  const selectedId = useAppStore(
    (s) =>
      s.settings?.activeClaudeManagedAccountIdsByRuntime?.host ??
      s.settings?.activeClaudeManagedAccountId ??
      null
  )
  const hostAccounts = accounts.filter((account) => account.managedAuthRuntime !== 'wsl')
  if (hostAccounts.length === 0 || !launchesClaudeTerminal(agentMenu)) {
    return null
  }
  const launchOn = (account: ClaudeManagedAccount): void => {
    const result = launchAgentInNewTab({
      requestId: newAgentLaunchRequestId(),
      requestedSurface: 'terminal',
      agent: 'claude',
      worktreeId,
      groupId,
      claudeAccountId: account.id,
      launchSource: 'tab_bar_quick_launch'
    })
    if (!result) {
      // Refusals for an unsupported workspace already explained themselves.
      return
    }
    if (result.surface.kind === 'local-terminal') {
      onFocusTerminal(result.surface.tabId)
    }
    toast.success(
      translate('claudeAccountLaunch.started', 'Claude started on {{value0}}', {
        value0: account.email
      })
    )
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <AgentIcon agent="claude" size={14} />
        <span className="flex-1">{translate('claudeAccountLaunch.menu', 'Claude on account')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[220px] max-w-[320px]">
        {hostAccounts.map((account) => {
          const detail = accountDetail(account)
          return (
            <DropdownMenuItem key={account.id} variant="launch" onSelect={() => launchOn(account)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{account.email}</span>
                {detail ? (
                  <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
                ) : null}
              </span>
              {account.id === selectedId ? (
                <Check
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label={translate('claudeAccountLaunch.selected', 'Selected account')}
                />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
