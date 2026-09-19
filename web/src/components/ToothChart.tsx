import { useI18n } from '../i18n'

// FDI numbering, drawn as the dentist faces the patient: the patient's right is on the viewer's left.
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type Props = {
  selected: Set<number>
  onToggle: (tooth: number) => void
  /** Teeth that already have work in this plan, shown as marked. */
  marked?: Set<number>
}

export function ToothChart({ selected, onToggle, marked }: Props) {
  const { t } = useI18n()
  const row = (teeth: number[]) =>
    teeth.map((n, i) => (
      <button
        key={n}
        type="button"
        className={`tooth ${selected.has(n) ? 'is-selected' : ''} ${marked?.has(n) ? 'is-marked' : ''} ${i === 7 ? 'is-midline' : ''}`}
        aria-pressed={selected.has(n)}
        onClick={() => onToggle(n)}
      >
        {n}
      </button>
    ))

  return (
    <div className="tooth-chart" dir="ltr" role="group" aria-label={t('chart.label')}>
      <div className="tooth-side"><span>{t('chart.right')}</span><span>{t('chart.left')}</span></div>
      <div className="tooth-row">{row(UPPER)}</div>
      <div className="tooth-row">{row(LOWER)}</div>
    </div>
  )
}
