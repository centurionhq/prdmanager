import { Check } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './ToastProvider.module.css';

export type ToastTone = 'neutral' | 'success';

export interface ToastOptions {
  readonly tone?: ToastTone;
}

export interface ToastContextValue {
  readonly show: (message: string, options?: ToastOptions) => void;
}

interface ToastState {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

const AUTO_DISMISS_MS = 4000;

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  readonly children: ReactNode;
}

/** Bottom-right (bottom-center on mobile) `role="status"` toast, auto-dismissed after 4s. */
export function ToastProvider({ children }: ToastProviderProps): ReactElement {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setToast({ id, message, tone: options?.tone ?? 'neutral' });

    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, AUTO_DISMISS_MS);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toast ? (
          <div className={styles.toast}>
            {toast.tone === 'success' ? <Check aria-hidden="true" size={16} className={styles.icon} /> : null}
            {toast.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

/** Must be called from inside a `<ToastProvider>`. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
