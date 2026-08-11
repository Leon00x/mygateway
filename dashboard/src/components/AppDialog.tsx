import { createContext, createSignal, onCleanup, onMount, Show, useContext, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { t } from '../i18n';

interface DialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogState extends DialogOptions {
  mode: 'confirm' | 'notice';
  resolve: (result: boolean) => void;
}

interface DialogService {
  confirm: (options: DialogOptions) => Promise<boolean>;
  notice: (options: DialogOptions) => Promise<void>;
}

const DialogContext = createContext<DialogService>();

export function useAppDialog(): DialogService {
  const service = useContext(DialogContext);
  if (!service) throw new Error('useAppDialog must be used inside DialogProvider');
  return service;
}

export function DialogProvider(props: { children: JSX.Element }) {
  const [dialog, setDialog] = createSignal<DialogState | null>(null);
  let primaryButton: HTMLButtonElement | undefined;

  const open = (mode: DialogState['mode'], options: DialogOptions) =>
    new Promise<boolean>((resolve) => {
      dialog()?.resolve(false);
      setDialog({ ...options, mode, resolve });
      queueMicrotask(() => primaryButton?.focus());
    });
  const close = (result: boolean) => {
    const current = dialog();
    if (!current) return;
    setDialog(null);
    current.resolve(result);
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dialog()) close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const service: DialogService = {
    confirm: (options) => open('confirm', options),
    notice: async (options) => {
      await open('notice', options);
    },
  };

  return (
    <DialogContext.Provider value={service}>
      {props.children}
      <Show when={dialog()}>
        {(current) => (
          <Portal>
            <div class="modal-backdrop app-dialog-backdrop" onClick={() => close(false)}>
              <section class="modal-card app-dialog" classList={{ danger: Boolean(current().danger) }} role={current().mode === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" onClick={(event) => event.stopPropagation()}>
                <div class="app-dialog-icon" aria-hidden="true">
                  {current().danger ? '!' : 'i'}
                </div>
                <div class="app-dialog-copy">
                  <h3 id="app-dialog-title">{current().title}</h3>
                  <p id="app-dialog-message">{current().message}</p>
                </div>
                <div class="modal-actions app-dialog-actions">
                  <Show when={current().mode === 'confirm'}>
                    <button type="button" class="secondary-button" onClick={() => close(false)}>
                      {t('common.cancel')}
                    </button>
                  </Show>
                  <button ref={primaryButton} type="button" class={current().danger ? 'danger-button' : 'primary-button'} onClick={() => close(true)}>
                    {current().confirmLabel ?? t('common.confirm')}
                  </button>
                </div>
              </section>
            </div>
          </Portal>
        )}
      </Show>
    </DialogContext.Provider>
  );
}
