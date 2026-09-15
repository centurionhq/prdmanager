/**
 * People and invitations (WO-272). The 5 named people from the brief plus 3 more for volume, and
 * 1 pending invitation. Ids here are the canonical person ids referenced across documents.ts,
 * versions.ts and comments.ts (WO-271).
 */
import type { Invitation, Person } from './types';

export const PEOPLE: readonly Person[] = [
  {
    id: 'ana-rios',
    name: 'Ana Ríos',
    initials: 'AR',
    email: 'ana.rios@centurionhq.com',
    actor: 'dev:ana',
    projectRole: 'admin',
    orgRole: 'admin',
    title: 'Admin de proyecto',
    lastAccess: '2026-09-15T09:56:00.000Z',
  },
  {
    id: 'julia-paz',
    name: 'Julia Paz',
    initials: 'JP',
    email: 'julia.paz@centurionhq.com',
    actor: 'dev:julia',
    projectRole: 'editor',
    orgRole: 'member',
    title: 'Arquitecta',
    lastAccess: '2026-09-15T09:47:00.000Z',
  },
  {
    id: 'martin-sosa',
    name: 'Martín Sosa',
    initials: 'MS',
    email: 'martin.sosa@centurionhq.com',
    actor: 'dev:martin',
    projectRole: 'developer',
    orgRole: 'member',
    title: 'Developer',
    lastAccess: '2026-09-15T09:22:00.000Z',
  },
  {
    id: 'lucas-vera',
    name: 'Lucas Vera',
    initials: 'LV',
    email: 'lucas.vera@centurionhq.com',
    actor: 'dev:lucas',
    projectRole: 'commenter',
    orgRole: 'member',
    title: 'Commenter',
    lastAccess: '2026-09-15T08:00:00.000Z',
  },
  {
    id: 'sofia-ibarra',
    name: 'Sofía Ibarra',
    initials: 'SI',
    email: 'sofia.ibarra@centurionhq.com',
    actor: 'dev:sofia',
    projectRole: 'viewer',
    orgRole: 'member',
    title: 'Viewer',
    lastAccess: '2026-09-14T16:00:00.000Z',
  },
  {
    id: 'diego-fernandez',
    name: 'Diego Fernández',
    initials: 'DF',
    email: 'diego.fernandez@centurionhq.com',
    actor: 'dev:diego',
    projectRole: 'developer',
    orgRole: 'member',
    title: 'Developer',
    lastAccess: '2026-09-14T11:00:00.000Z',
  },
  {
    id: 'carla-nunez',
    name: 'Carla Núñez',
    initials: 'CN',
    email: 'carla.nunez@centurionhq.com',
    actor: 'dev:carla',
    projectRole: 'viewer',
    orgRole: 'member',
    title: 'Analista de producto',
    lastAccess: '2026-09-12T10:00:00.000Z',
  },
  {
    id: 'pablo-rossi',
    name: 'Pablo Rossi',
    initials: 'PR',
    email: 'pablo.rossi@centurionhq.com',
    actor: 'dev:pablo',
    projectRole: 'admin',
    orgRole: 'owner',
    title: 'Owner de Centurion HQ',
    lastAccess: '2026-09-10T09:00:00.000Z',
  },
];

export const INVITATIONS: readonly Invitation[] = [
  {
    email: 'tomas@centurionhq.com',
    role: 'developer',
    invitedBy: 'ana-rios',
    sentAt: '2026-09-14T09:00:00.000Z',
    expiresAt: '2026-09-21T09:00:00.000Z',
  },
];

export function getPerson(id: string): Person | undefined {
  return PEOPLE.find((person) => person.id === id);
}
