import { useI18n } from '../i18n'

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n()
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
  return (
    <div className="error-note" role="alert">
      <p>{t('common.error', { message })}</p>
      {onRetry && <button className="btn" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  )
}
