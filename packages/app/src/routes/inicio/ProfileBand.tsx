/**
 * The Planta's entry band (SDD-051/PRD-033 R1). The Planta stays the screen the project opens on; this band
 * sits above the line and answers "where do I start?" without sending anyone to the list of documents.
 *
 * Two states, both approved on the canvas (`PlantaBanda.dc.html`, `PlantaBandaMobile.dc.html`):
 *  - nothing chosen yet: it asks what the person came to do, three plates in plain words;
 *  - chosen: one line with their next step, a way out to build, and "Cambiar" to pick again in place.
 *
 * Changing the profile never goes through Ajustes (R1). The profile is a routing preference, not a
 * permission: nothing here reads `subject`, and nothing is hidden or blocked by it.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import type { WorkProfile } from '@prdm/contracts';
import { Button, OptionPlates, type OptionPlate } from '../../components/index.js';
import { projectBasePath } from '../../components/shell/project-nav.js';
import { useProjectShellContext } from '../ProjectShell.js';
import styles from './ProfileBand.module.css';
import { WORK_PROFILE_COPY, WORK_PROFILE_ORDER } from './work-profiles.js';

const OPTIONS: readonly OptionPlate[] = WORK_PROFILE_ORDER.map((profile) => ({
  value: profile,
  title: WORK_PROFILE_COPY[profile].title,
  description: WORK_PROFILE_COPY[profile].description,
}));

function isWorkProfile(value: string): value is WorkProfile {
  return WORK_PROFILE_ORDER.some((profile) => profile === value);
}

export function ProfileBand(): ReactElement {
  const { orgSlug, projectSlug, workProfile, chooseWorkProfile } = useProjectShellContext();
  const [changing, setChanging] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [focusSummary, setFocusSummary] = useState(false);
  const summaryRef = useRef<HTMLElement | null>(null);

  // Picking unmounts the plate that had focus and mounts the summary, which would drop focus on <body>.
  // It goes to the summary instead, so a keyboard or screen-reader user lands on their next step.
  useEffect(() => {
    if (!focusSummary || workProfile === null || changing) return;
    summaryRef.current?.focus();
    setFocusSummary(false);
  }, [focusSummary, workProfile, changing]);

  async function handleChoose(value: string): Promise<void> {
    if (!isWorkProfile(value)) return;
    setSaveFailed(false);
    // The choice shows at once, whether it was the first or a change: the shell updates the profile before
    // the server answers, and the chooser closes with it. That is also why there is no "saving" state to
    // guard against a second click -- the plate that could be clicked again is already gone.
    const wasChanging = changing;
    setChanging(false);
    setFocusSummary(true);
    try {
      await chooseWorkProfile(value);
    } catch {
      // The shell already put the previous profile back. Reopen the chooser (a first choice is back to
      // `null`, which reopens it by itself) and say what happened.
      setChanging(wasChanging);
      setFocusSummary(false);
      setSaveFailed(true);
    }
  }

  const showChooser = workProfile === null || changing;

  if (showChooser) {
    return (
      <section aria-labelledby="planta-banda-titulo" className={styles.band}>
        <div className={styles.heading}>
          <h2 id="planta-banda-titulo" className={styles.title}>
            ¿Qué venís a hacer acá?
          </h2>
          <p className={styles.hint}>Elegí una vez y la Planta te deja el próximo paso a mano. Podés cambiarlo cuando quieras.</p>
        </div>
        <OptionPlates label="¿Qué venís a hacer acá?" mode="action" options={OPTIONS} onChange={(value) => void handleChoose(value)} />
        {saveFailed ? (
          <p role="alert" className={styles.error}>
            No pudimos guardar tu elección. Probá de nuevo.
          </p>
        ) : null}
        {changing ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setChanging(false)}>
              Cancelar
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  const copy = WORK_PROFILE_COPY[workProfile];
  return (
    <section ref={summaryRef} tabIndex={-1} aria-label="Tu próximo paso" className={styles.band}>
      <div className={styles.summary}>
        <div className={styles.summaryText}>
          <span className={styles.identity}>{copy.identity}</span>
          <span className={styles.nextStep}>{copy.nextStep}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
            Cambiar
          </Button>
          <Link to={`${projectBasePath(orgSlug, projectSlug)}/${copy.destination}`} className={styles.cta}>
            {copy.action}
          </Link>
        </div>
      </div>
    </section>
  );
}
