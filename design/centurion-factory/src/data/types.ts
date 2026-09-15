/**
 * Mock domain types for the Centurion Factory design package (SDD-011).
 *
 * Modeled on @prdm/core (domain schema, drift monitor, closure readiness, metrics) and @prdm/contracts
 * (documents, versions, comments, agent proposals, roles, tokens) WITHOUT importing them: this package is
 * isolated (ADR-007) and only mirrors the shapes the real API will return when a later PRD wires it up.
 */

// ── Identity ──────────────────────────────────────────────────────────────────────────────────────────

export type FeatureKind = 'MRD' | 'PRD' | 'FR';
export type BlueprintKind = 'SDD' | 'ADR';
export type DocumentKind = FeatureKind | BlueprintKind | 'WO' | 'ART' | 'FB';

/** `agent:claude`, `dev:martin` — the same actor grammar as `assigned_to` in the graph. */
export type ActorRef = `agent:${string}` | `dev:${string}`;

export type OrgRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'admin' | 'editor' | 'developer' | 'commenter' | 'viewer';

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly actor: ActorRef;
  readonly projectRole: ProjectRole;
  readonly orgRole: OrgRole;
  readonly title: string;
  readonly lastAccess: string;
}

export interface Invitation {
  readonly email: string;
  readonly role: ProjectRole;
  readonly invitedBy: string;
  readonly sentAt: string;
  readonly expiresAt: string;
}

// ── Lifecycle (PRD-002 §3) ────────────────────────────────────────────────────────────────────────────

export const STATIONS = ['ingesta', 'definicion', 'diseno', 'planificacion', 'ejecucion', 'cierre'] as const;
export type Station = (typeof STATIONS)[number];

export const STATION_LABELS: Readonly<Record<Station, string>> = {
  ingesta: 'Ingesta',
  definicion: 'Definición',
  diseno: 'Diseño',
  planificacion: 'Planificación',
  ejecucion: 'Ejecución',
  cierre: 'Cierre',
};

// ── Features and blueprints ───────────────────────────────────────────────────────────────────────────

export type FeatureStatus = 'draft' | 'proposed' | 'approved' | 'closed';

export interface Feature {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly station: Station;
  /** Parent feature (EVOLVES_FROM); undefined for the root MRD. */
  readonly evolvesFrom?: string;
  readonly justifiedBy: readonly string[];
  readonly blueprintIds: readonly string[];
  readonly createdAt: string;
  readonly closedAt?: string;
  /** True when the id/title are sample values rather than real nodes of the graph. */
  readonly sample: boolean;
}

export type BlueprintStatus = 'active' | 'superseded';

export interface Blueprint {
  readonly id: string;
  readonly kind: BlueprintKind;
  readonly title: string;
  readonly status: BlueprintStatus;
  readonly architects: readonly string[];
  readonly impactsPaths: readonly string[];
  readonly changedAt: string;
  readonly sample: boolean;
}

// ── Work orders ───────────────────────────────────────────────────────────────────────────────────────

export type WorkOrderStatus = 'pending' | 'in_progress' | 'done' | 'out_of_sync';

export interface WorkOrder {
  readonly id: string;
  readonly title: string;
  readonly status: WorkOrderStatus;
  readonly blueprintId: string;
  readonly featureId: string;
  readonly assignedTo?: ActorRef;
  readonly objective: string;
  readonly criteria: readonly { readonly text: string; readonly done: boolean }[];
  readonly governedPaths: readonly string[];
  readonly commitShas: readonly string[];
  readonly updatedAt: string;
  readonly claimedAt?: string;
  readonly completedAt?: string;
  /** For out_of_sync orders: the blueprint change that stranded them. */
  readonly outOfSyncReason?: string;
  readonly sample: boolean;
}

// ── Code and commits ──────────────────────────────────────────────────────────────────────────────────

export type SyncStatus = 'synced' | 'out_of_sync';
export type SyncReason =
  | 'unchanged'
  | 'new'
  | 'resolved_by_commit'
  | 'code_changed'
  | 'missing'
  | 'blueprint_changed'
  | 'feature_changed';

export interface CodeRef {
  readonly key: string;
  readonly path: string;
  readonly symbol?: string;
  readonly blueprintId: string;
  readonly status: SyncStatus;
  readonly reason: SyncReason;
}

export interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly author: ActorRef;
  readonly date: string;
  readonly refs: readonly string[];
  readonly files: readonly string[];
}

// ── Drift (core sync monitor + SaaS code reports) ─────────────────────────────────────────────────────

export type DriftKind =
  | 'broken_link'
  | 'invalid_link_target'
  | 'feature_changed'
  | 'blueprint_changed'
  | 'code_out_of_sync'
  | 'work_order_out_of_sync'
  | 'status_write_failed'
  | 'impacts_warning'
  | 'deprecated_field'
  | 'lifecycle_violation'
  | 'awaiting_ci_report';

export type Severity = 'error' | 'warning';

export interface DriftIssue {
  readonly id: string;
  readonly kind: DriftKind;
  readonly severity: Severity;
  readonly nodeId: string;
  readonly target?: string;
  readonly featureId?: string;
  readonly blueprintId?: string;
  readonly message: string;
  readonly detectedAt: string;
}

export type ReportMode = 'baseline' | 'preview';

export interface DriftReport {
  readonly id: string;
  readonly mode: ReportMode;
  readonly branch: string;
  readonly headSha: string;
  readonly tokenName: string;
  readonly tokenPrefix: string;
  readonly issueCount: number;
  readonly hasBlockingIssues: boolean;
  readonly createdAt: string;
  /** A preview branch whose CI has not reported yet. */
  readonly awaitingCi?: boolean;
}

// ── Metrics (core metrics.ts) ─────────────────────────────────────────────────────────────────────────

export interface Metrics {
  readonly agentHumanEfficiency: {
    readonly completedWorkOrders: number;
    readonly measuredWorkOrders: number;
    readonly avgResolutionHours: number;
    readonly medianResolutionHours: number;
  };
  readonly systemIntegrity: {
    readonly governedTotal: number;
    readonly governedSynced: number;
    readonly syncedPercent: number;
  };
  readonly traceability: {
    readonly featuresTotal: number;
    readonly featuresTraced: number;
    readonly featurePercent: number;
    readonly commitsTotal: number;
    readonly commitsWithRefs: number;
    readonly commitsTraced: number;
    readonly commitPercent: number;
  };
}

// ── Closure readiness (core lifecycle/close.ts) ───────────────────────────────────────────────────────

export type ClosureCheckName =
  | 'feature_exists'
  | 'feature_approved'
  | 'blueprints_have_work_orders'
  | 'work_orders_done'
  | 'project_clean';

export interface ClosureReadiness {
  readonly featureId: string;
  readonly ready: boolean;
  readonly checks: readonly { readonly name: ClosureCheckName; readonly ok: boolean; readonly detail: string }[];
}

// ── Documents (contracts: documents, versions, comments, agent) ───────────────────────────────────────

export type WorkflowState = 'draft' | 'in_review' | 'published' | 'archived';
export type DocumentOrigin = 'collab' | 'generated' | 'import';

/** Rich-text blocks: the editor's preview renders them and the Markdown tab serializes them. */
export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'ol' | 'task';

export interface DocumentBlock {
  readonly id: string;
  readonly type: BlockType;
  readonly text: string;
  readonly checked?: boolean;
  /** Person id, or `agent` for accepted agent edits (blame). */
  readonly author: string;
  readonly acceptedBy?: string;
}

export interface ProjectDocument {
  readonly id: string;
  readonly kind: Exclude<DocumentKind, 'WO'>;
  readonly title: string;
  readonly workflowState: WorkflowState;
  readonly origin: DocumentOrigin;
  readonly sourcePath: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly tags: readonly string[];
  readonly blocks: readonly DocumentBlock[];
  readonly sample: boolean;
}

export type VersionReason =
  | 'manual'
  | 'review_request'
  | 'published'
  | 'agent_accept'
  | 'restore'
  | 'engine_write'
  | 'import';

export interface DocumentVersion {
  readonly documentId: string;
  readonly versionNo: number;
  readonly reason: VersionReason;
  readonly label?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly contributors: readonly string[];
}

export interface CommentMessage {
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface CommentThread {
  readonly id: string;
  readonly documentId: string;
  readonly quotedText: string;
  readonly status: 'open' | 'resolved';
  readonly createdBy: string;
  readonly resolvedBy?: string;
  readonly comments: readonly CommentMessage[];
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export interface AgentProposal {
  readonly id: string;
  readonly documentId: string;
  readonly agent: ActorRef;
  readonly status: ProposalStatus;
  readonly summary: string;
  readonly edits: readonly { readonly section: string; readonly expectedText: string; readonly replacement: string }[];
  readonly requestedBy: string;
  readonly respondedBy?: string;
  readonly createdAt: string;
}

export interface ValidationIssue {
  readonly documentId: string;
  readonly severity: Severity;
  readonly code: string;
  readonly field?: string;
  readonly message: string;
}

// ── Inbox: feedback and artifacts ─────────────────────────────────────────────────────────────────────

export type FeedbackStatus = 'new' | 'triaged';
export type ArtifactSource = 'meeting' | 'email' | 'slack' | 'call' | 'doc' | 'other';

export interface InboxItem {
  readonly id: string;
  readonly kind: 'FB' | 'ART';
  readonly title: string;
  readonly body: string;
  readonly source: ArtifactSource | 'chat';
  readonly customer?: string;
  readonly status: FeedbackStatus;
  /** FB `informs` / ART `provides_context_for`. */
  readonly links: readonly string[];
  readonly receivedAt: string;
  readonly candidates: readonly { readonly featureId: string; readonly score: number; readonly reason: string }[];
  readonly sample: boolean;
}

// ── Organization, projects and settings ───────────────────────────────────────────────────────────────

export interface ProjectSummary {
  readonly slug: string;
  readonly name: string;
  readonly documentCount: number;
  readonly archived: boolean;
  readonly furthestStation: Station;
  readonly andonStation?: Station;
  readonly driftErrors: number;
  readonly driftWarnings: number;
  readonly awaitingFirstReport: boolean;
  readonly workOrdersInProgress: number;
  readonly role: ProjectRole;
  readonly lastActivity: string;
}

export type TokenScope = 'mcp:read' | 'mcp:write' | 'governance:read' | 'reports:write' | 'reports:baseline' | 'import:write';

export interface CiToken {
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly TokenScope[];
  readonly branch: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsed?: string;
  readonly expired: boolean;
}

export interface SsoSettings {
  readonly protocol: 'oidc' | 'saml';
  readonly provider: string;
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly domains: readonly { readonly domain: string; readonly verified: boolean; readonly since?: string; readonly txtRecord?: string }[];
  readonly enforceSso: boolean;
  readonly jitProvisioning: boolean;
  readonly defaultOrgRole: OrgRole;
  readonly emergencyPasswordAccess: boolean;
}
