import { useCallback, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  /** The explanation itself. Always present in the DOM and linked by `aria-describedby`, so assistive
   * tech reads it whether or not it is visually shown -- see this component's own doc comment. */
  readonly text: string;
  /** What the tooltip explains. Made focusable so the tooltip is reachable without a pointer. */
  readonly children: ReactNode;
  /** `onDark` lightens the trigger's dotted underline for a dark surface (the Planta's line band); the
   * plate itself is the same light surface either way, as the approved canvas draws it. */
  readonly tone?: 'light' | 'onDark';
}

/**
 * Hover/focus explanation plate (SDD-027, WO-454; approved canvas: the station header band on
 * `design/centurion-factory/canvas/Main.dc.html`).
 *
 * The text never disappears for assistive tech: it lives in the DOM permanently and the trigger points
 * at it with `aria-describedby`, so hover/focus only drive the *visual* presentation. That is what keeps
 * PRD-011 §4.3's "que se entienda de una" true for a screen reader even though SDD-027 moved the
 * explanation behind a pointer for sighted users. The hidden state is therefore clipped (the same
 * `visually-hidden` technique `base.css` uses), never `display: none`, which not every screen reader
 * resolves through an `aria-describedby` reference.
 *
 * Shown on hover AND on keyboard focus (never hover-only), dismissed with `Escape` while focused --
 * WAI-ARIA's own tooltip expectations, plus the design system's "visible keyboard focus" quality floor.
 * Deliberately has no delay and no transition: a delay needs a timer per trigger and buys nothing for a
 * plate this small, and with zero motion there is nothing for `prefers-reduced-motion` to disable.
 */
export function Tooltip({ text, children, tone = 'light' }: TooltipProps): ReactElement {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape') setVisible(false);
  }, []);

  const triggerClassName = [styles.trigger, tone === 'onDark' ? styles.triggerOnDark : null].filter((value): value is string => Boolean(value)).join(' ');
  const plateClassName = [styles.plate, visible ? styles.plateVisible : null].filter((value): value is string => Boolean(value)).join(' ');

  return (
    <span className={styles.wrapper}>
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className={triggerClassName}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
      <span id={tooltipId} role="tooltip" className={plateClassName}>
        {text}
      </span>
    </span>
  );
}
