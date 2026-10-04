import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { LockedError, loadData, saveData, type StoreData } from '@/lib/store';

/** Loads the (possibly encrypted) data, keeps it fresh, and serialises read-modify-write updates. */
export function useStore() {
  const [data, setData] = useState<StoreData | null>(null);
  const [locked, setLocked] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await loadData());
      setLocked(false);
    } catch (e) {
      if (e instanceof LockedError) {
        setData(null);
        setLocked(true);
      } else throw e;
    }
  }, []);

  useEffect(() => {
    void reload();
    // the background writes learned site rules while this page is open
    const onChange = (_c: unknown, area: string) => {
      if (area === 'local' || area === 'session') void reload();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [reload]);

  /** Re-read the latest data, apply `fn`, save. Avoids clobbering concurrent background writes. */
  const update = useCallback(async (fn: (d: StoreData) => StoreData) => {
    const next = fn(await loadData());
    await saveData(next);
    setData(next);
  }, []);

  return { data, locked, reload, update };
}
