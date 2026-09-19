/** The clinic mark: a simple molar outline. */
export function ToothMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M9.5 4.5c-3.3 0-5.5 2.6-5.5 6.2 0 3 1.2 5 2.2 7.4.9 2.2 1.1 4.7 1.6 7 .4 1.7 1.3 2.4 2.3 2.4 1.4 0 2-1.3 2.4-3.3.5-2.4 1.4-4.4 3.5-4.4s3 2 3.5 4.4c.4 2 1 3.3 2.4 3.3 1 0 1.9-.7 2.3-2.4.5-2.3.7-4.8 1.6-7 1-2.4 2.2-4.4 2.2-7.4 0-3.6-2.2-6.2-5.5-6.2-2.6 0-4 1.3-6.5 1.3S12.1 4.5 9.5 4.5Z"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
      />
    </svg>
  )
}
