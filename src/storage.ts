
import { get, set, del } from 'idb-keyval';

const KEY = 'md_saved_dir_handle_v1';

export async function saveDirHandle(handle: FileSystemDirectoryHandle) {
  try {
    await set(KEY, handle);
    return true;
  } catch {
    return false;
  }
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = (await get(KEY)) as FileSystemDirectoryHandle | undefined;
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function clearDirHandle() {
  try {
    await del(KEY);
  } catch {}
}
