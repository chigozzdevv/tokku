import type { HTMLAttributes, PropsWithChildren } from 'react'
import { forwardRef } from 'react'

export const Section = forwardRef<HTMLElement, PropsWithChildren<HTMLAttributes<HTMLElement>>>(
  ({ className, ...rest }, ref) => {
    const cls = ['section', className].filter(Boolean).join(' ')
    return <section ref={ref} className={cls} {...rest} />
  }
)

Section.displayName = 'Section'

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="section-header" style={{ textAlign: 'center' }}>
      <h2 className="section-title">{title}</h2>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </header>
  )
}

export function SectionDivider() {
  return <hr className="section-divider" />
}
