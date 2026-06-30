/**
 * Persistance de session (jour glissant sur N jours).
 *
 * Abstraction du backend de stockage : par défaut localStorage, mais
 * `createSessionStore` accepte n'importe quel objet { getItem, setItem,
 * removeItem }. Le jour du passage natif, injecter un adaptateur (ex.
 * Capacitor Preferences) sans toucher au reste.
 */

const STORE_KEY = 'rapports_missions_state_v1';
const STORE_DAYS = 3;

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/**
 * @param {Storage|{getItem,setItem,removeItem}} backend
 */
export function createSessionStore(backend = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  function loadStore() {
    if (!backend) return {};
    try {
      const raw = backend.getItem(STORE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Rétrocompat : ancien format à plat { day, missions, ... }
      if (parsed && parsed.day && !parsed.days) return { [parsed.day]: parsed };
      return (parsed && parsed.days) ? parsed.days : {};
    } catch (e) {
      return {};
    }
  }

  function pruneStore(store) {
    const keys = Object.keys(store).sort().reverse();
    keys.slice(STORE_DAYS).forEach((k) => delete store[k]);
    return store;
  }

  return {
    todayKey,

    /** Sauvegarde l'état du jour. `snapshot` = { porterSelect, porterCustom, planning, missions }. */
    save(snapshot) {
      if (!backend) return;
      try {
        const day = todayKey();
        const store = loadStore();
        store[day] = { day, ...snapshot };
        pruneStore(store);
        backend.setItem(STORE_KEY, JSON.stringify({ days: store }));
      } catch (e) { /* stockage indisponible : on continue */ }
    },

    /** Restaure la session la plus récente (aujourd'hui en priorité). */
    restore() {
      const store = pruneStore(loadStore());
      const keys = Object.keys(store).sort().reverse();
      return keys.length ? store[keys[0]] : null;
    },

    /** Efface uniquement la session du jour ; conserve les précédentes. */
    clearToday() {
      if (!backend) return;
      try {
        const store = loadStore();
        delete store[todayKey()];
        if (Object.keys(store).length) backend.setItem(STORE_KEY, JSON.stringify({ days: store }));
        else backend.removeItem(STORE_KEY);
      } catch (e) { /* ignore */ }
    },
  };
}
