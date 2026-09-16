---
id: "FB-008"
type: "FB"
title: "SSO por organización (OIDC/SAML) — fuera de alcance de PRD-007, para un PRD futuro"
status: "new"
created_at: "2026-09-15"
source: "chat"
informs: ["PRD-006","PRD-005"]
---

## Feedback

Registro para un futuro PRD de autenticación federada. El rediseño de Centurion Factory (PRD-006) incluyó pantallas de login con SSO primero (email de trabajo, Google Workspace, Microsoft Entra ID) y de Ajustes › Autenticación y SSO (proveedor OIDC/SAML, dominios verificados por TXT, exigir SSO, alta automática JIT, acceso de emergencia con contraseña). Al planificar PRD-007 (conectar ese front al backend real de PRD-005) se confirmó que SSO no existe en el backend: better-auth (ADR-006, SDD-006) solo implementa email/contraseña con TOTP obligatorio para superadmins, sin ningún plugin OIDC/SAML ni de proveedor social.

PRD-007 deja SSO explícitamente fuera de alcance: el login conectado usa email/contraseña, los botones de SSO y la pantalla de Ajustes › SSO quedan ocultos hasta que exista un backend real. Este feedback queda para justificar ese PRD futuro: agregar better-auth con un proveedor OIDC (y evaluar SAML) por organización, verificación de dominio, reglas de acceso (exigir SSO, JIT) y la superficie de seguridad correspondiente (revisión dedicada, dado que amplía la autenticación).
