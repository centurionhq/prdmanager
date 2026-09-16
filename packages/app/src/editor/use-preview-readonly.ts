/**
 * Bundles the mobile-breakpoint check into `isPreviewReadOnly` (SDD-014 §"Editor de vista previa",
 * WO-382) — same `767px` breakpoint the rest of the app uses (`AppShell`/`Tabs`/`PublishReviewModal`
 * modules, `../lib/use-media-query.js`), not `DataTable`'s own narrower `640px`.
 */
import { useMediaQuery } from '../lib/use-media-query.js';
import { isPreviewReadOnly, type PreviewReadOnlyInputs } from './preview-readonly.js';

const MOBILE_QUERY = '(max-width: 767px)';

export function usePreviewReadOnly(inputs: Omit<PreviewReadOnlyInputs, 'isMobile'>): boolean {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  return isPreviewReadOnly({ ...inputs, isMobile });
}
