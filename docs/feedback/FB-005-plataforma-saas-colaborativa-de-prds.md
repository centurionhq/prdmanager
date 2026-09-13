---
id: "FB-005"
type: "FB"
title: "Plataforma SaaS colaborativa de PRDs con agente, versionado, permisos y MCP remoto"
status: "new"
created_at: "2026-09-13"
source: "chat"
informs: ["PRD-005"]
---

## Feedback

El usuario descarta el PRD de "indexar todo el repositorio en el grafo" (no se llegó a crear ningún documento) y pide otro:

> "Debemos tener un dashboard para poder elegir proyecto, y poder crear los PRD de forma colaborativa entre usuarios, donde sos ayudado por un agente conversacional pero también podés editar los documentos manualmente, con versionado y gestión de usuarios: cada usuario puede tocar el documento si tiene permisos y queda registro de quién tocó esa línea, se pueden dejar comentarios y más cosas. La idea es que estos PRD vayan quedando en el dashboard y luego sean tomados por developers con su code assistant y el MCP de prdm para ir tomando las nuevas cosas."

Decisiones tomadas en la conversación:

- **Forma de producto:** SaaS multi-organización (organizaciones → proyectos → documentos), con aislamiento estricto entre organizaciones.
- **Fuente de verdad:** el SaaS guarda los documentos (mismo formato `.md` + frontmatter y misma validación del core) y el grafo. Los repositorios de código son de cada organización y el SaaS nunca escribe en ellos.
- **Colaboración:** edición en tiempo real (CRDT), autoría por línea que un cliente no puede falsificar, versiones y comentarios.
- **Usuarios:** email y contraseña propios, **solo por invitación** (las organizaciones las crea un superadmin de la plataforma).
- **Developers:** consumen PRDs, SDDs y WOs publicados con un **MCP remoto** del SaaS autenticado con tokens personales.
- **Drift y política `Refs:`:** en alcance. El prdm local del developer baja la gobernanza del SaaS y reporta hashes de código y commits; **solo el token de CI en la rama por defecto avanza el estado oficial**, el resto es vista previa.
- **Agente conversacional:** DeepSeek `deepseek-v4-flash` con clave de la plataforma (`DEEPSEEK_API_KEY` en `.env`, nunca commiteada), **siempre activo** como parte del producto, con cuotas.
- **Importador:** un repo prdm existente (incluido este) puede subir sus documentos al SaaS con `prdm link --import`.
- **MVP:** núcleo colaborativo. Billing, SSO, notificaciones más allá de invitaciones y reseteo, escalado horizontal, escritura en git del cliente e índice de código quedan para PRDs posteriores.
- **Forma de trabajo:** igual que PRD-004, subagentes expertos y skills en cada fase con compuertas de revisión, y WOs capilares (un WO = un commit verificable).
