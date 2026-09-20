/**
 * The developer path of the Planta's entry band (SDD-055/PRD-033 R4),
 * `/o/:orgSlug/p/:projectSlug/construir/developer`: the three setup steps, copyable, with the real state of
 * the installation for this person and this project, and the data of the project beside them.
 *
 * The steps and their commands come from one data table (`./construir/developer-setup.ts`); the state comes
 * from the only two things the server can know (`./construir/installation-state.ts`). Everything else about
 * someone's machine is unknowable from here, and the copy says so rather than guessing.
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { listPersonalTokens } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { CopyBlock, FilterChips, IdTag, PageHeader } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { ASSISTANTS, MCP_ENTRY_SNIPPET, developerSetupSteps, type SetupStepId } from './construir/developer-setup.js';
import { installationState, type InstallationState } from './construir/installation-state.js';
import styles from './ConstruirDeveloper.module.css';
import { useProjectShellContext } from './ProjectShell.js';

const STEP_DONE: Readonly<Record<SetupStepId, (state: InstallationState) => boolean>> = {
  credencial: (state) => state.hasCredential,
  // Linking and the assistant are proven by the same single fact: something authenticated with the
  // credential, which only the proxy running from that person's own machine does.
  vincular: (state) => state.everConnected,
  asistente: (state) => state.everConnected,
};

function stateLabel(state: InstallationState): string {
  if (state.everConnected) return 'Conectado';
  return state.hasCredential ? 'Credencial creada, falta vincular' : 'Sin conectar';
}

export function ConstruirDeveloper(): ReactElement {
  const { orgSlug, projectSlug, project } = useProjectShellContext();
  useDocumentTitle('Conectar tu entorno');
  const base = projectBasePath(orgSlug, projectSlug);
  const origin = window.location.origin;
  const [assistantId, setAssistantId] = useState<string>(() => ASSISTANTS[0]?.id ?? '');

  const tokensQuery = useApiQuery(`personal-tokens:${orgSlug}`, () => listPersonalTokens(orgSlug), [orgSlug], () => false);
  const state = installationState(tokensQuery.data ?? [], new Date());
  const steps = developerSetupSteps({ orgSlug, projectSlug, origin });
  const assistant = ASSISTANTS.find((candidate) => candidate.id === assistantId) ?? ASSISTANTS[0];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <Link to={base}>Planta</Link> / Conectar tu entorno
          </>
        }
        title="Conectar tu entorno a este proyecto"
        subtitle="Tres pasos. Al final, tu asistente de código ve las órdenes de trabajo de este proyecto y puede tomarlas sin que le pegues el contexto a mano."
        actions={
          <span className={styles.status}>
            <span className={[styles.dot, state.everConnected ? styles.dotOn : null].filter(Boolean).join(' ')} aria-hidden="true" />
            {stateLabel(state)}
          </span>
        }
      />

      {tokensQuery.status === 'error' ? (
        <p role="status" className={styles.notice}>
          No pudimos leer tus credenciales, así que no podemos decirte en qué paso estás. Los pasos de abajo valen igual.
        </p>
      ) : null}

      <div className={styles.columns}>
        <ol aria-label="Pasos de puesta en marcha" className={styles.steps}>
          {steps.map((step, index) => {
            const done = STEP_DONE[step.id](state);
            const current = state.currentStep === step.id;
            return (
              <li key={step.id} className={styles.step} {...(current ? { 'aria-current': 'step' as const } : {})}>
                <span className={[styles.number, done ? styles.numberDone : current ? styles.numberCurrent : null].filter(Boolean).join(' ')} aria-hidden="true">
                  {index + 1}
                </span>
                <div className={styles.stepBody}>
                  <div className={styles.stepHeading}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={styles.stepState}>{done ? 'Listo' : current ? 'Te toca esto' : 'Pendiente'}</span>
                  </div>
                  <p className={styles.stepText}>{step.body}</p>

                  {step.id === 'credencial' ? (
                    <div className={styles.stepActions}>
                      {state.hasCredential ? (
                        <Link to={`${base}/ajustes/tokens-personales`}>Ver mis credenciales</Link>
                      ) : (
                        <Link to={`${base}/ajustes/tokens-personales`} className={styles.cta}>
                          Crear credencial
                        </Link>
                      )}
                    </div>
                  ) : null}

                  {step.commands ? <CopyBlock label="Comandos para vincular el repositorio" text={step.commands} /> : null}

                  {step.id === 'vincular' && state.hasCredential && !state.everConnected ? (
                    <p className={styles.stepText}>Todavía no vimos ninguna conexión con esa credencial. En cuanto tu asistente se conecte, este paso se marca solo.</p>
                  ) : null}

                  {step.id === 'asistente' && assistant ? (
                    <>
                      <FilterChips label="Elegí tu asistente" options={ASSISTANTS.map((a) => ({ value: a.id, label: a.label }))} value={assistant.id} onChange={setAssistantId} />
                      <p className={styles.stepText}>{assistant.body}</p>
                      {assistant.needsSnippet ? <CopyBlock label="Entrada para tu cliente MCP" text={MCP_ENTRY_SNIPPET} /> : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

      </div>
    </div>
  );
}
