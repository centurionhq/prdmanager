# ConfirmDialog — decisiones de diseño

Canvas: `ConfirmDialog.dc.html` (nuevo, registrado en `canvas.json`, página "Acceso y ajustes"). Cubre 1440 y 375, tres estados (reposo, en vuelo, error) y el copy de los cinco casos.

## 1. Qué se veía mal (evidencia)

Observado en `https://centurion.ngrok.app/o/centurionhq/p/prdmanager/ajustes/tokens` a 1440 y 375 (screenshots + DOM). No hice clic en "Revocar" para no destruir un token real; lo siguiente sale del código.

- **Revocar ejecuta sin preguntar.** `TokenTable.tsx:63` llama `onRevoke(token.id)` directo desde el botón. Hay tres tokens reales en la tabla (incluido `github-actions-real-ci`, el que alimenta la baseline) a un clic accidental de distancia.
- **No existe ningún componente de confirmación.** `grep ConfirmDialog` en `packages/app/src` da cero resultados. Los modales de acción que sí existen (Reconocer drift, Archivar orden, etc.) son formularios con botón primario azul; ninguno comunica "destructivo".
- **El botón destructivo existente no tiene peso.** `Button variant="destructive"` es rojo delineado sobre fondo claro. Al lado de "Cancelar" (también delineado) los dos pesan igual y la jerarquía queda plana.
- **El botón de la fila es chico a 1440.** Mide 32 px de alto (`size="sm"`) en desktop. A 375 mide 44 px, está bien.
- **A 375 el botón queda lejos de lo que revoca.** En la tarjeta, "Revocar" está al final de una pila de seis filas de datos, bajo la etiqueta "Acciones:". Por eso el diálogo tiene que repetir qué recurso se afecta.
- **Los modales actuales no resuelven el estado de error ni el de envío.** `AcknowledgeModal` solo hace `disabled={submitting}`; no hay lugar para decir "no se pudo" sin cerrar el diálogo.

## 2. Decisiones

**Estructura.** Modal `size="md"` (520) con tres capas, de arriba a abajo:
1. Título en el slot del Modal: verbo + tipo de recurso ("Revocar token de CI", "Quitar del proyecto"). Corto a propósito: el título del Modal es 28/800 y un nombre largo ocuparía tres líneas a 375.
2. Descripción: la consecuencia, en una o dos frases. Va antes que el recurso porque es lo que se lee para decidir.
3. **Placa del recurso**: fondo `--relleno`, filete izquierdo `--paro` de 3 px, nombre en 16/700 y dato de contexto en 13 `--apagado` (quién lo creó, último uso, rol, vencimiento). Es lo que "nombra el recurso afectado" y deja confirmar que es el correcto. `overflow-wrap:anywhere` para emails y nombres largos.

**Jerarquía de acciones.** "Cancelar" = `secondary`; acción = `destructive` **sólido** (`--paro` con texto `--blanco`, contraste 6.3:1). Es lo único rojo y lleno del diálogo. Orden en DOM y visual: Cancelar, luego la acción (la acción queda a la derecha en desktop, como en el resto de los modales).

**Foco.** Inicial en Cancelar, con `--focus-ring` visible (comp, estado 1). Esc, X y clic en el fondo cancelan. El foco vuelve al botón que abrió el diálogo.

**Espaciado y tipografía.** Solo tokens: paddings de `--space-6` (24) en desktop y 20 en mobile, gap interno de `--space-3`/`--space-4`, pie con `--rule-row`. Descripción 14/20 `--texto-secundario`. En mobile el título baja a 24 para que "Quitar de la organización" no pase de dos líneas.

**Densidad / 375.** Panel de 327 px (375 menos 2 × 24 de margen del Modal), sin scroll horizontal. Botones apilados a ancho completo, 44 px, Cancelar arriba (el pulgar llega primero a la salida segura), acción abajo. La X crece a 44 px, como ya hace el Modal.

**Estados.**
- *En vuelo*: la acción se queda con su ancho, muestra spinner y cambia el texto ("Revocando", "Quitando"); Cancelar y X se apagan; hay un texto `aria-live="polite"`. El diálogo no se cierra hasta que el servidor responde. El spinner se detiene con `prefers-reduced-motion`.
- *Error*: aviso `role="alert"` dentro del diálogo (fondo `--diff-quitado`, borde `--paro`), que dice qué pasó y **qué estado quedó** ("El token sigue activo"). La acción pasa a "Reintentar", Cancelar vuelve a estar activo y el foco se mueve al aviso o queda en Reintentar.
- *Éxito*: el diálogo se cierra y el aviso lo da un toast (`ToastProvider`), no el diálogo.

**Copy.** Sentence case, voseo como el resto del canvas ("Copialo", "Podés"), sin jerga del motor (nada de `onRevoke`, 401, "token id"). Todos dicen qué deja de funcionar. Los cinco textos están en la tabla del canvas. Solo la **invitación** omite "No se puede deshacer", porque se puede volver a invitar.

## 3. Qué cambia respecto de hoy

| Hoy | Con ConfirmDialog |
|---|---|
| Revocar / quitar se ejecuta al primer clic | Siempre pasa por un diálogo que nombra el recurso |
| Sin componente de confirmación; cada modal inventa su pie | Una pieza reutilizable con tres estados definidos |
| Destructivo = botón delineado rojo, igual peso que Cancelar | Acción en rojo sólido, Cancelar neutro, foco en Cancelar |
| Error de red: depende de cada pantalla | Aviso dentro del diálogo, con el estado en que quedó el recurso y "Reintentar" |
| En mobile cada modal decide su pie | Botones apilados, 44 px, ancho completo |

## 4. Quién decide qué

**Producto (prdm-pm)**
- Si el diálogo aplica a *todas* las acciones destructivas de Ajustes o solo a estas cinco (el canvas asume estas cinco).
- Los textos de consecuencia, sobre todo los que afirman comportamiento del producto y que hay que validar:
  - quitar del proyecto conserva comentarios y cambios;
  - quitar de la organización invalida los tokens personales;
  - que un miembro quitado del proyecto "sigue en la organización";
  - que revocar un token de CI frena la baseline oficial.
- Si revocar el token de CI (que alimenta la baseline) merece un paso extra, por ejemplo escribir el nombre. No lo dibujé: me parece desproporcionado para una acción que se corrige creando otro token.
- Si "Revocar invitación" debe llevar o no el aviso de irreversible (acá no lo lleva).

**Front (prdm-frontend)**
- Crear `ConfirmDialog` sobre `Modal` con props `title`, `description`, `resource: {name, meta}`, `confirmLabel`, `busyLabel`, `error`, `onConfirm`, `onClose`.
- **Extender `Button`** con una variante sólida (propuesta: `destructive-solid`, `--paro` / `--blanco`, hover más oscuro; hoy no existe ni el token de hover). Si preferís no tocar `Button`, el fallback es `destructive` delineado, a costa de la jerarquía descrita arriba.
- Foco inicial en Cancelar (`autoFocus` o ref) y retorno del foco al disparador.
- Estado "en vuelo" con `aria-disabled` en vez de `disabled` en la acción, para no perder el foco; bloquear Esc, X y clic en el fondo mientras dura.
- `role="alert"` en el error; `aria-live="polite"` en el texto de progreso.
- El botón "Revocar" de `TokenTable` abre el diálogo en lugar de llamar `onRevoke`.
- Verificar a 375 que el diálogo scrollea por dentro si el error no entra; el Modal actual no lo resuelve (`max-height` ausente).
