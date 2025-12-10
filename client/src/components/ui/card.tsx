import type { HTMLAttributes, PropsWithChildren } from 'react'

export function Card({ className, ...rest }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  const cls = ['card', className].filter(Boolean).join(' ')
  return <div className={cls} {...rest} />
}

