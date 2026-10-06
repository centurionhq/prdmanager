// Every route the screenshot script captures (SDD-011). Keep in sync with src/router.tsx.
export const SCREENSHOT_ROUTES = [
  { name: 'login', path: '/login' },
  { name: 'proyectos', path: '/proyectos' },
  { name: 'planta', path: '/' },
  // WO-669: same screen with the «Commits trazados» drawer open; `click` is the accessible name of the control.
  { name: 'planta-commits', path: '/', click: 'Commits trazados: 166/250' },
  { name: 'arbol', path: '/arbol/PRD-004' },
  { name: 'documentos', path: '/documentos' },
  { name: 'documento', path: '/documentos/SDD-011' },
  { name: 'ordenes', path: '/ordenes' },
  // WO-756: el drawer de una orden pendiente con el modal «Tomar orden» abierto (SDD-086 §D2).
  { name: 'ordenes-tomar', path: '/ordenes?orden=WO-311', click: 'Tomar orden' },
  { name: 'drift', path: '/drift' },
  { name: 'entrada', path: '/entrada' },
  { name: 'ajustes-miembros', path: '/ajustes/miembros' },
  { name: 'ajustes-tokens', path: '/ajustes/tokens' },
  { name: 'ajustes-sso', path: '/ajustes/sso' },
];

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
];
