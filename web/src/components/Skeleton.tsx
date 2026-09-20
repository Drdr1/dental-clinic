/** Placeholder blocks shaped like the content that's loading, instead of a bare "Loading…". */
export function Skeleton({ rows = 3, variant = 'list' }: { rows?: number; variant?: 'list' | 'table' | 'cards' }) {
  return (
    <div className={`skeleton skeleton-${variant}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" />)}
    </div>
  )
}
