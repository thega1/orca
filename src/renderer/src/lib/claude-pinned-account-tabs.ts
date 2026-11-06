import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

/**
 * Terminal tabs started on a chosen Claude account from the "+" menu. Switching the selected
 * account must not offer to restart them: they were never on the selected account by choice.
 * Kept for this window's life; a restored tab follows the selected account again.
 */
const pinnedAccountByTabId = new Map<string, string>()

export function pinClaudeTabToAccount(tabId: string, accountId: string): void {
  pinnedAccountByTabId.set(tabId, accountId)
}

export function getClaudeTabPinnedAccountId(tabId: string): string | null {
  return pinnedAccountByTabId.get(tabId) ?? null
}

export function refuseUnpinnableClaudeAccountLaunch(): void {
  toast.error(
    translate(
      'claudeAccountLaunch.unsupported',
      'Choosing a Claude account works only for local terminals.'
    ),
    {
      description: translate(
        'claudeAccountLaunch.unsupportedDetail',
        'Switch the selected account to start Claude on it in this workspace.'
      )
    }
  )
}
