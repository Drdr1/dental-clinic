import { useI18n } from '../i18n'
import { ToothSide } from './ToothFigure'

// FDI numbering, drawn as the dentist faces the patient: the patient's right is on the viewer's left.
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type Props = {
  selected: Set<number>
  onToggle: (tooth: number) => void
  /** Teeth that already have work in this plan, shown as marked. */
  marked?: Set<number>
}

/** Tap the teeth a procedure applies to: the same drawn teeth as the patient's chart, small. */
export function ToothChart({ selected, onToggle, marked }: Props) {
  const { t } = useI18n()
  const tooth = (n: number, upper: boolean) => {
    const on = selected.has(n)
    const status = on ? 'progress' : marked?.has(n) ? 'planned' : 'healthy'
    const num = <span className={`tf-n ${on ? 'st-pick' : ''}`}>{n}</span>
    return (
      <button key={n} type="button" className={`tooth4 ${on ? 'is-selected' : ''}`} aria-pressed={on}
        aria-label={t('plan.tooth', { n })} onClick={() => onToggle(n)}>
        {upper ? <><ToothSide n={n} status={status} kind="none" />{num}</> : <>{num}<ToothSide n={n} status={status} kind="none" /></>}
      </button>
    )
  }
  return (
    <div className="tooth-pick" role="group" aria-label={t('chart.label')}>
      <div className="tooth-scroll">
        <div className="tooth-pick-row" dir="ltr">{UPPER.map((n) => tooth(n, true))}</div>
        <div className="tooth-pick-row is-lower" dir="ltr">{LOWER.map((n) => tooth(n, false))}</div>
      </div>
      <div className="tooth-side" dir="ltr"><span>{t('chart.right')}</span><span>{t('chart.left')}</span></div>
    </div>
  )
}
