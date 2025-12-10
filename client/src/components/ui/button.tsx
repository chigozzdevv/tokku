import { cloneElement, isValidElement } from 'react'
import type { ButtonHTMLAttributes, PropsWithChildren, ReactElement } from 'react'

type Variant = 'primary' | 'surface' | 'ghost'

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant
    asChild?: boolean
  }
>

export function Button({
  variant = 'surface',
  className,
  asChild,
  children,
  ...rest
}: Props) {
  const base = 'btn'
  const variants: Record<Variant, string> = {
    primary: 'btn-primary',
    surface: '',
    ghost: '',
  }
  const cls = [base, variants[variant], className].filter(Boolean).join(' ')
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<any>
    const { type: _type, ...childProps } = rest
    return cloneElement(child, {
      ...(childProps as Record<string, unknown>),
      className: [child.props?.className, cls].filter(Boolean).join(' '),
    })
  }

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}

