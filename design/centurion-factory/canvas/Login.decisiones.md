# Login: decisiones de diseño (BC-034 / FR-027)

Comp: `Login.dc.html` (escritorio 1440 y móvil 375, con selector de vista y de estado arriba, solo para la maqueta).

> **Limitación de esta pasada.** El MCP de Chrome no respondió (el perfil del navegador ya estaba abierto por otra sesión), así que **no hay capturas ni DOM de `/login` real**. Lo de la sección 1 sale del canvas vigente (`Login.dc.html`, `LoginMobile.dc.html`, `LoginTotp.dc.html`) y de la nota de ronda B de `canvas.json`. Hay que contrastarlo con la pantalla viva antes de aprobar. Tampoco pude abrir el comp en el runtime de canvas (`support.js` no está en la carpeta): la sintaxis `sc-if`/`sc-for` copia la de los otros `.dc.html`, pero falta verlo renderizado.

## 1. Qué se veía mal

- **Nombre y versión internos** en el pie: «Centurion Factory · prdmanager 0.2.0». Jerga de la herramienta, sin valor para quien llega por un enlace.
- **No dice a dónde entrás.** El `next` trae `/o/<org>/p/<proj>`, pero el título es «Entrá a tu organización», genérico. Quien recibió un enlace no puede confirmar que es el lugar correcto.
- **Sin camino si no tenés acceso.** «El acceso es solo por invitación» queda como un dato apagado de 14 px, sin acción. El único consejo («pedí un nuevo acceso a tu admin») aparece recién después de fallar, y no dice cómo.
- **Jerarquía plana.** Wordmark y título miden 28 px y compiten; la explicación es gris sobre acero y casi no se lee como instrucción.
- **Espaciado.** Columna de 400 px a `top: 180px` en un lienzo de 1440, con ~1000 px vacíos; en 375 el bloque flota sin ancla.
- **Estados pobres.** Un error rojo y nada más: sin «entrando», sin error de campo, sin estado de pedido.
- **Targets.** En escritorio «Mostrar» mide 32 px y «Volver…» 40 px; en móvil hay que garantizar 44 px.
- **Canvas desactualizado.** Todavía dibuja botones SSO (Google, Entra, «Continuar con SSO»), que la ronda B ya sacó de la pantalla real.

## 2. Decisiones

- **Jerarquía.** Dos columnas en escritorio: a la izquierda *dónde entrás* (título «Te invitaron a trabajar en Planta de acero», tarjeta con organización y proyecto), a la derecha la acción (panel de formulario). En móvil se apilan en ese orden: primero el contexto, después el formulario.
- **Contexto.** Organización y proyecto en una tarjeta de dos filas, con sus nombres de usuario («Centurion HQ», «Planta de acero»), nunca el slug. Va antes del formulario porque responde la primera duda.
- **Acceso por invitación en lenguaje llano.** Una frase arriba («El acceso es solo por invitación») y, junto a la acción, qué hacer si no tenés: «Pedíselo a los administradores de Centurion HQ».
- **Acción secundaria.** «Pedir acceso a Centurion HQ» es un botón *secundario*, separado por una regla bajo «Olvidé mi contraseña». Entrar sigue siendo la única acción primaria.
- **Formulario de pedido.** Email, nombre y mensaje opcional. Una pantalla propia con «Volver a entrar» arriba, para no mezclar dos formularios.
- **Confirmación.** Panel «Pedido enviado» con aviso verde (`--senal-texto` sobre `--diff-agregado`) que dice qué quedó registrado y a qué email llegará la respuesta; salida clara a «Volver a entrar».
- **Estados.** Entrar, entrando (botón deshabilitado con spinner, que respeta `prefers-reduced-motion`), datos incorrectos (aviso + borde `--paro` de 2 px, `aria-invalid`), segundo paso, pedir acceso, error de campo, error de servidor (conserva lo escrito), enviado.
- **Tipografía.** Wordmark 20 px/800 ancho 125 %; título del panel 28 px/700 (20 px en móvil); cuerpo 14 px (16 px en móvil, evita el zoom de iOS al enfocar). Sentence case, sin mayúsculas decorativas, sin mono (no hay identificadores literales a la vista).
- **Espaciado.** Solo escala 4/8/12/16/24/32/48. Panel con 32 px de padding (16 px en móvil), 24 px entre bloques, 16 px entre campos, 6 px etiqueta–campo.
- **A11y.** `:focus-visible` con `--focus-ring`; etiquetas `for`/`id`; `role="alert"` para errores y `role="status"` para la confirmación; el error nunca depende solo del color (borde grueso + texto + cuadrado); `--control-height` pasa a 44 px en móvil; «Mostrar» usa `aria-pressed`. Contrastes con los pares ya probados de `tokens.test.ts` (`--apagado` sobre `--superficie`, `--paro`, `--senal-texto`).
- **Sin SSO.** Se eliminaron los botones SSO, en línea con la ronda B.
- **Pie.** Se eliminan nombre y versión interna; la marca queda solo en el wordmark de arriba.

## 3. Qué cambia respecto de hoy

| Hoy | Propuesto |
|---|---|
| Título genérico «Entrá a tu organización» | «Entrá a Centurion HQ» + tarjeta con organización y proyecto del enlace |
| Una frase gris sobre invitación | Explicación en llano + camino concreto para pedir acceso |
| Sin forma de pedir acceso | Botón secundario → formulario (email, nombre, mensaje) → confirmación |
| Pie «Centurion Factory · prdmanager 0.2.0» | Sin pie con nombre ni versión |
| Columna única de 400 px, flotando | Dos columnas (contexto / acción) en 1440; apilado en 375 |
| Un solo error | Cargando, error de credenciales, error de campo, error del pedido, éxito |
| «Mostrar» de 32 px | 40 px escritorio, 44 px móvil |

`LoginMobile.dc.html` queda superado por este comp (todavía dibuja SSO y la versión); conviene retirarlo del canvas cuando se apruebe. `LoginTotp.dc.html` se conserva; el paso TOTP está replicado acá dentro del mismo panel.

## 4. Quién decide qué

**Producto (prdm-pm)**
- Si «Pedir acceso» está abierto a cualquier email o solo a dominios permitidos, y cómo se evita el spam (límite de tasa, captcha).
- Qué ve quien pide acceso con un email que ya es miembro, o ya pidió: el comp usa siempre la misma confirmación para no revelar quién es miembro; confirmar o cambiar.
- Si se revela el nombre de la organización y del proyecto a una persona *sin sesión* a partir del `next` (hoy el comp lo hace; es una fuga leve de información si el enlace circula).
- Qué pasa tras el pedido: quién lo recibe, en cuánto tiempo, si se promete un plazo (el comp no promete ninguno) y qué ve el administrador.
- Largo máximo del mensaje y si el nombre es obligatorio.
- Qué se muestra si el `next` no trae organización o es inválido (propuesta: título genérico sin tarjeta; sin definir).

**Front (prdm-frontend)**
- Resolver el nombre de organización y proyecto desde el `next` con un endpoint público mínimo; estado «cargando» con `Skeleton` en la tarjeta y fallback genérico si falla.
- Reutilizar `TextField`, `Button`, `Notice`, `FormError`; hacen falta variantes nuevas: `Notice` en variante éxito/error (hoy solo neutra), `TextField` multilínea y el campo de contraseña con «Mostrar».
- Quitar el nombre/versión del pie y la prop que lo alimenta.
- Foco: al abrir «Pedir acceso» enfocar el título; al fallar, enfocar el primer campo con error o el aviso.
- Validación de email en cliente con mensaje en llano; no mostrar mensajes del motor.
- Tests por rol y nombre accesible; revisar que el layout de 375 no tenga scroll horizontal y los targets sean de 44 px.
- Prueba de tokens: el comp usa variables, no hex (el spinner y la sombra del marco son solo de maqueta).
