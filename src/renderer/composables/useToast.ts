/**
 * Toast notification composable
 * Provides a simple way to show snackbar notifications throughout the app
 */

import { ref } from 'vue';

export interface ToastOptions {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  timeout?: number;
}

interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  timeout: number;
}

// Global state for toast notifications
const toastState = ref<ToastState>({
  visible: false,
  message: '',
  type: 'info',
  timeout: 3000,
});

export function useToast() {
  function show(options: ToastOptions) {
    toastState.value = {
      visible: true,
      message: options.message,
      type: options.type || 'info',
      timeout: options.timeout || 3000,
    };
  }

  function success(message: string, timeout?: number) {
    show({ message, type: 'success', timeout });
  }

  function error(message: string, timeout?: number) {
    show({ message, type: 'error', timeout: timeout || 5000 });
  }

  function warning(message: string, timeout?: number) {
    show({ message, type: 'warning', timeout });
  }

  function info(message: string, timeout?: number) {
    show({ message, type: 'info', timeout });
  }

  function hide() {
    toastState.value.visible = false;
  }

  return {
    toastState,
    show,
    success,
    error,
    warning,
    info,
    hide,
  };
}
