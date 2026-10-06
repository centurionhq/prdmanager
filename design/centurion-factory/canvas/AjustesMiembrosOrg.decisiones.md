# Ajustes · miembros de la organización — decisiones (WO-733 / SDD-099)

## Qué faltaba
El comp sólo dibujaba miembros e invitaciones pendientes: la bandeja de solicitudes de acceso (FR-027) no existía,
y la pantalla real ya la muestra para owner/admin.

## Decisiones de diseño
- Sección «Solicitudes de acceso» debajo de los miembros, con la misma tabla y reglas de 1 px (sin sombras, sin tarjetas).
- Columnas: Persona (nombre + email, o sólo el email si no hay nombre), Mensaje («Sin mensaje» de fallback), Cuándo.
- Acciones a la derecha: «Aprobar» (cianotipo, acción primaria) y «Rechazar» (rojo, destructiva), como Reenviar/Revocar.
- Estado vacío en texto llano: «No hay solicitudes de acceso pendientes.» (el comp lo muestra debajo para documentarlo).
- El artboard crece de 960 a 1180 px de alto (también en `canvas.json`).

## Quién decide qué
- Producto (`prdm-pm`): copy del mensaje y del estado vacío; si el motivo del rechazo se le muestra a la persona o queda sólo en auditoría.
- Front: ancho de la columna de acciones, orden de columnas y el diálogo de rechazo (motivo opcional, 500 caracteres).
