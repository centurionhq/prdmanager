/** Settings sub-navigation, grouped by scope (WO-304). Keep in sync with src/router.tsx. */
export interface AjustesNavItem {
  readonly to: string;
  readonly label: string;
}

export interface AjustesNavGroup {
  readonly label: string;
  readonly items: readonly AjustesNavItem[];
}

export const AJUSTES_NAV_GROUPS: readonly AjustesNavGroup[] = [
  {
    label: 'Proyecto prdmanager',
    items: [
      { to: '/ajustes/general', label: 'General' },
      { to: '/ajustes/miembros', label: 'Miembros' },
      { to: '/ajustes/tokens', label: 'Tokens de CI' },
      { to: '/ajustes/integraciones', label: 'Integraciones' },
    ],
  },
  {
    label: 'Centurion HQ',
    items: [
      { to: '/ajustes/miembros-organizacion', label: 'Miembros de la organización' },
      { to: '/ajustes/sso', label: 'Autenticación y SSO' },
      { to: '/ajustes/auditoria', label: 'Auditoría' },
    ],
  },
  {
    label: 'Tu cuenta',
    items: [
      { to: '/ajustes/perfil', label: 'Perfil' },
      { to: '/ajustes/tokens-personales', label: 'Tokens personales' },
    ],
  },
];
