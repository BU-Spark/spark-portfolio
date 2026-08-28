// Shared project store — merges seed projects with admin-added ones (localStorage).
(function () {
  const KEY = "spark_custom_projects_v1";

  function loadCustom() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveCustom(arr) {
    localStorage.setItem(KEY, JSON.stringify(arr));
  }

  const listeners = new Set();
  function notify() { listeners.forEach((fn) => fn()); }

  const SparkStore = {
    getProjects() {
      // custom (newest admin additions) first, then seed
      return [...loadCustom(), ...(window.SPARK_PROJECTS || [])];
    },
    getCustom: loadCustom,
    addProject(p) {
      const custom = loadCustom();
      custom.unshift(p);
      saveCustom(custom);
      notify();
      return p;
    },
    removeCustom(id) {
      saveCustom(loadCustom().filter((p) => p.id !== id));
      notify();
    },
    clearCustom() { saveCustom([]); notify(); },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // cross-tab / cross-page sync
  window.addEventListener("storage", (e) => { if (e.key === KEY) notify(); });

  window.SparkStore = SparkStore;
})();
