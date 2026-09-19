import { useI18n } from '../i18n'
import { errorKey } from '../lib/errors'

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n()
  const key = errorKey(error)
  const raw = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
  return (
    <div className="error-note" role="alert">
      <p>{key ? t(key) : t('common.error', { message: raw })}</p>
      {onRetry && <button className="btn" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  )
}
