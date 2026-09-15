import type { ButtonHTMLAttributes, ReactElement } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: styles.secondary,
  destructive: styles.destructive,
  ghost: styles.ghost,
};

/** Sentence-case, 2px-radius button. See the "Botones" plate on Componentes.dc.html. */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...buttonProps
}: ButtonProps): ReactElement {
  const classes = [styles.button, VARIANT_CLASS[variant], size === 'sm' ? styles.sm : null, className ?? null]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return <button type={type} className={classes} {...buttonProps} />;
}
