import { useI18n } from '../../i18n'
import type { MonthPoint } from './api'

/** Six months of income vs expenses, drawn as plain SVG bars — no chart library needed. */
export function TrendChart({ points }: { points: MonthPoint[] }) {
  const { t, money, lang } = useI18n()
  const max = Math.max(...points.flatMap((p) => [p.income, p.expenses]), 1)
  const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { month: 'short' })

  return (
    <div className="trend">
      <div className="trend-legend">
        <span><i className="swatch swatch-income" />{t('fin.income')}</span>
        <span><i className="swatch swatch-expense" />{t('fin.expenses')}</span>
      </div>
      <div className="trend-bars" dir="ltr">
        {points.map((p) => (
          <div key={p.month} className="trend-month">
            <div className="trend-pair">
              <div className="trend-bar trend-in" style={{ height: `${(p.income / max) * 100}%` }}
                title={`${t('fin.income')}: ${money(p.income)}`} />
              <div className="trend-bar trend-out" style={{ height: `${(p.expenses / max) * 100}%` }}
                title={`${t('fin.expenses')}: ${money(p.expenses)}`} />
            </div>
            <span className="trend-label">{monthName.format(new Date(`${p.month}T12:00:00`))}</span>
            <span className={`trend-net ${p.net < 0 ? 'danger-text' : 'muted'}`}>{money(p.net)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
