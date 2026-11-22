import { useI18n } from '../../i18n'
import type { MonthPoint } from './api'

/** Six months of income vs expenses, drawn as plain SVG bars — no chart library needed. */
export function TrendChart({ points }: { points: MonthPoint[] }) {
  const { t, money, lang } = useI18n()
  const max = Math.max(...points.flatMap((p) => [p.income, p.expenses]), 1)
  const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { month: 'long' })

  return (
    <div className="trend2">
      <div className="trend2-bars">
        {points.map((p, i) => {
          const now = i === points.length - 1
          return (
            <div key={p.month} className={`trend2-month${now ? ' is-now' : ''}`}>
              <div className="trend2-pair">
                <div className="trend2-bar in" style={{ height: `${(p.income / max) * 100}%` }} title={`${t('fin.income')}: ${money(p.income)}`} />
                <div className="trend2-bar out" style={{ height: `${(p.expenses / max) * 100}%` }} title={`${t('fin.expenses')}: ${money(p.expenses)}`} />
              </div>
              <span className="trend2-label">{monthName.format(new Date(`${p.month}T12:00:00`))}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
