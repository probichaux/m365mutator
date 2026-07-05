import {
  Toaster, useToastController, useId,
  Toast, ToastTitle,
  type ToastIntent,
} from '@fluentui/react-components';
import { createContext, useContext, useCallback, type ReactNode } from 'react';

type ShowToast = (message: string, intent: ToastIntent) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);

  const show: ShowToast = useCallback((message, intent) => {
    dispatchToast(
      <Toast>
        <ToastTitle>{message}</ToastTitle>
      </Toast>,
      { intent, timeout: intent === 'success' ? 5000 : 15000 },
    );
  }, [dispatchToast]);

  return (
    <ToastContext.Provider value={show}>
      <Toaster toasterId={toasterId} position="top-end" />
      {children}
    </ToastContext.Provider>
  );
}
