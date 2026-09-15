import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';

export async function confirmPresentationDeletion(isTauriApp: boolean, message: string): Promise<boolean> {
  return isTauriApp ? tauriConfirm(message) : window.confirm(message);
}
