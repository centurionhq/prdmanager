import type { ReactElement } from 'react';
import { Link, type LinkProps } from 'react-router';
// Reuses Button's visual styles for a real <a>: EmptyState/ErrorState use the Button component for
// actions that call a handler, but "Nuevo documento" must be a link so ctrl/cmd-click and "open in
// a new tab" keep working. No LinkButton exists in src/components yet — reported in the WO summary.
import buttonStyles from '../../components/Button/Button.module.css';

export interface LinkButtonProps extends LinkProps {
  readonly variant?: 'primary' | 'secondary';
}

export function LinkButton({ variant = 'secondary', className, ...linkProps }: LinkButtonProps): ReactElement {
  const classes = [buttonStyles.button, variant === 'primary' ? buttonStyles.primary : buttonStyles.secondary, className ?? null]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return <Link className={classes} {...linkProps} />;
}
