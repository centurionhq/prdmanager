import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import styles from './ProyectosPage.module.css';

/** Top bar for /proyectos (no project shell): wordmark, org switcher, settings link and person. */
export function TopBar(): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function handlePointerDown(event: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <span className={styles.wordmark}>Centurion Factory</span>
        <span className={styles.topBarDivider} aria-hidden="true" />
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
      </div>
      <div className={styles.topBarRight}>
        <Link to="/ajustes/sso" className={styles.settingsLink}>
          Ajustes de la organización
        </Link>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">
            AR
          </span>
          <span className={styles.personName}>Ana Ríos</span>
        </div>
      </div>
    </div>
  );
}
