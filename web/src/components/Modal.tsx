import { useEffect, useRef, type ReactNode } from 'react'

/** Native <dialog>: focus trapping, Esc to close and the backdrop come from the browser. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title}>
      <div className="dialog-body">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  )
}
