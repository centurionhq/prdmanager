/**
 * Project and project-member DTOs (SDD-006 §Modelo de datos / §Permisos, WO-107): shared between
 * `packages/server`'s `/api/app/organizations/:orgSlug/projects/*` routes and (in a later WO)
 * `packages/app`'s typed API client.
 */
import { z } from 'zod';
import { PROJECT_ROLES } from './permissions.js';
import { projectSettingsSchema } from './project-settings.js';

export const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const projectSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(PROJECT_SLUG_PATTERN, 'lowercase letters, digits and single hyphens only, no leading/trailing/double hyphens');

export const projectNameSchema = z.string().min(1).max(100);

export const projectRoleSchema = z.enum(PROJECT_ROLES);

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: projectSlugSchema,
  name: projectNameSchema,
  /** `prj_<16 lowercase hex>`, always server-generated (SDD-006 §Modelo de datos). */
  graphProjectId: z.string(),
  settings: projectSettingsSchema,
  archivedAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/** `settings` is optional on create: an omitted value gets every field's default from
 * {@link projectSettingsSchema} (parsing `{}` through it, same as a freshly-scaffolded `.prdm.yaml`). */
export const createProjectInputSchema = z.object({
  slug: projectSlugSchema,
  name: projectNameSchema,
  settings: projectSettingsSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** A settings update is a full replacement (validated the same way as create), not a partial merge —
 * the dashboard's settings screen always submits the complete, current settings object back. */
export const updateProjectSettingsInputSchema = z.object({
  settings: projectSettingsSchema,
});
export type UpdateProjectSettingsInput = z.infer<typeof updateProjectSettingsInputSchema>;

export const projectMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: projectRoleSchema,
  /** ISO 8601 of this member's most recent activity on the project, `null` if they never have; optional
   * (rather than required) so an older server response missing this SDD-012 addition still parses. */
  lastActiveAt: z.string().nullable().optional(),
});
export type ProjectMemberDto = z.infer<typeof projectMemberSchema>;

export const addProjectMemberInputSchema = z.object({
  userId: z.string().min(1),
  role: projectRoleSchema,
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;

export const updateProjectMemberRoleInputSchema = z.object({ role: projectRoleSchema });
export type UpdateProjectMemberRoleInput = z.infer<typeof updateProjectMemberRoleInputSchema>;
