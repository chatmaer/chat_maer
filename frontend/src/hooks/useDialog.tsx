import React, { useState, useCallback } from 'react';
import Dialog, { DialogType, DialogOptions } from '../components/Dialog';

interface DialogState extends DialogOptions {
  isOpen: boolean;
  dialogType: DialogType;
}

export function useDialog() {
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const showAlert = useCallback((message: string, options?: Omit<DialogOptions, 'message'>) => {
    return new Promise<void>((resolve) => {
      setDialogState({
        isOpen: true,
        dialogType: 'alert',
        message,
        ...options,
        onConfirm: () => {
          options?.onConfirm?.();
          resolve();
        },
      });
    });
  }, []);

  const showConfirm = useCallback((message: string, options?: Omit<DialogOptions, 'message'>) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        isOpen: true,
        dialogType: 'confirm',
        message,
        confirmText: options?.confirmText || 'Yes',
        cancelText: options?.cancelText || 'No',
        ...options,
        onConfirm: () => {
          options?.onConfirm?.();
          resolve(true);
        },
        onCancel: () => {
          options?.onCancel?.();
          resolve(false);
        },
      });
    });
  }, []);

  const showPrompt = useCallback(
    (message: string, options?: Omit<DialogOptions, 'message'>) => {
      return new Promise<string | null>((resolve) => {
        setDialogState({
          isOpen: true,
          dialogType: 'prompt',
          message,
          placeholder: options?.placeholder || '',
          defaultValue: options?.defaultValue || '',
          ...options,
          onConfirm: (value) => {
            options?.onConfirm?.(value);
            resolve(value || null);
          },
          onCancel: () => {
            options?.onCancel?.();
            resolve(null);
          },
        });
      });
    },
    []
  );

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const DialogComponent = dialogState ? (
    <Dialog
      {...dialogState}
      onClose={closeDialog}
    />
  ) : null;

  return {
    showAlert,
    showConfirm,
    showPrompt,
    DialogComponent,
  };
}

