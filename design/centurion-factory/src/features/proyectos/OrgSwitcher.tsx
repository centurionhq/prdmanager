/** TopBar's organization switcher: a menu button that closes on outside click or Escape. */
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import styles from './ProyectosPage.module.css';

function useCloseOnOutsideOrEscape(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) onClose();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  return wrapRef;
}

export function OrgSwitcher(): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useCloseOnOutsideOrEscape(menuOpen, () => setMenuOpen(false));

  return (
    <div className={styles.switcherWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.switcherButton}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <span className={styles.switcherLabel}>Centurion HQ</span>
        <ChevronsUpDown aria-hidden="true" size={16} />
      </button>
      {menuOpen ? (
        <div role="menu" aria-label="Organizaciones" className={styles.menu}>
          <button type="button" role="menuitemradio" aria-checked="true" className={styles.menuItem}>
            Centurion HQ
            <Check aria-hidden="true" size={16} />
          </button>
          <button type="button" role="menuitemradio" aria-checked="false" disabled className={styles.menuItemDisabled}>
            Crear organización
          </button>
          <p className={styles.menuHint}>Pedíselo a un superadmin</p>
        </div>
      ) : null}
    </div>
  );
}
