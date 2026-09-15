/**
 * `/api/app/organizations/:orgSlug/projects/*` (SDD-006 §Modelo de datos / §Permisos, WO-107):
 * project CRUD, settings and project membership (WO-117/WO-118).
 */
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  ProjectMemberDto,
  ProjectSummary,
  UpdateProjectSettingsInput,
  ProjectRole,
} from '@prdm/contracts';
import { request } from './request.js';

function projectsBase(orgSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects`;
}

export function listProjects(orgSlug: string): Promise<ProjectSummary[]> {
  return request<{ projects: ProjectSummary[] }>(projectsBase(orgSlug)).then((r) => r.projects);
}

export function createProject(orgSlug: string, input: CreateProjectInput): Promise<ProjectSummary> {
  return request<{ project: ProjectSummary }>(projectsBase(orgSlug), { method: 'POST', body: input }).then((r) => r.project);
}

export function getProject(orgSlug: string, projectSlug: string): Promise<ProjectSummary> {
  return request<{ project: ProjectSummary }>(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}`).then((r) => r.project);
}

export function updateProjectSettings(orgSlug: string, projectSlug: string, input: UpdateProjectSettingsInput): Promise<ProjectSummary> {
  return request<{ project: ProjectSummary }>(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}/settings`, {
    method: 'PATCH',
    body: input,
  }).then((r) => r.project);
}

export function listProjectMembers(orgSlug: string, projectSlug: string): Promise<ProjectMemberDto[]> {
  return request<{ members: ProjectMemberDto[] }>(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}/members`).then(
    (r) => r.members,
  );
}

export function addProjectMember(orgSlug: string, projectSlug: string, input: AddProjectMemberInput): Promise<void> {
  return request(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}/members`, { method: 'POST', body: input }).then(() => undefined);
}

export function updateProjectMemberRole(orgSlug: string, projectSlug: string, userId: string, role: ProjectRole): Promise<void> {
  return request(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { role },
  }).then(() => undefined);
}

export function removeProjectMember(orgSlug: string, projectSlug: string, userId: string): Promise<void> {
  return request(`${projectsBase(orgSlug)}/${encodeURIComponent(projectSlug)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}
