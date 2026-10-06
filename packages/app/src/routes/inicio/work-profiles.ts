/**
 * What each work profile means for the Planta's entry band (SDD-051/PRD-033 R1): the words the chooser
 * shows, and where "comenzar a construir" leads. One table, so the copy and the destinations live in a
 * single place instead of being spread through JSX (the developer path, SDD-D, follows the same rule for
 * its setup steps).
 *
 * The wording is deliberately plain: no BC, PRD, SDD, FR or WO as something to pick (R1). It was approved
 * on the canvas (`design/centurion-factory/canvas/PlantaBanda.dc.html`), which wins over this file if
 * they ever disagree.
 */
import type { WorkProfile } from '@prdm/contracts';

export interface WorkProfileCopy {
  /** The option in the chooser. */
  readonly title: string;
  readonly description: string;
  /** Shown once the profile is chosen: who this person is here, then their next step and its button. */
  readonly identity: string;
  readonly nextStep: string;
  readonly action: string;
  /** Path under the project where "comenzar a construir" leads. Each one belongs to its own SDD: the
   * business path (SDD-B), the product path (SDD-C) and the developer path (SDD-D). */
  readonly destination: string;
}

export const WORK_PROFILE_COPY: Readonly<Record<WorkProfile, WorkProfileCopy>> = {
  negocio: {
    title: 'Traigo una necesidad del negocio',
    description: 'Escribí por qué conviene hacer algo, guiado sección por sección. Es el arranque de la línea.',
    identity: 'Traés una necesidad del negocio',
    nextStep: 'Escribir el caso de negocio de una iniciativa nueva',
    action: 'Empezar el caso de negocio',
    destination: 'construir/negocio',
  },
  producto: {
    title: 'Defino qué se construye',
    description: 'Convertí una iniciativa ya aprobada en requisitos que el equipo puede tomar.',
    identity: 'Definís qué se construye',
    nextStep: 'Convertir una iniciativa aprobada en requisitos',
    action: 'Escribir los requisitos',
    destination: 'construir/producto',
  },
  developer: {
    title: 'Escribo el código',
    description: 'Dejá tu entorno conectado al proyecto para tomar órdenes de trabajo desde tu editor.',
    identity: 'Escribís el código',
    nextStep: 'Conectar tu editor al proyecto para tomar órdenes',
    action: 'Conectar mi entorno',
    destination: 'construir/developer',
  },
};

/** Chooser order: the line's own order, from where work starts to where it is built. */
export const WORK_PROFILE_ORDER: readonly WorkProfile[] = ['negocio', 'producto', 'developer'];
