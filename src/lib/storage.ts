const API_KEY_STORAGE = 'meeting-transcriber-api-key';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}
