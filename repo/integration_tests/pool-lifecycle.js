import { pool } from "../backend/src/db.js";

export function createSuitePoolLifecycle(closePool) {
  let activeSuites = 0;
  let closePromise = null;

  function acquireSuite() {
    activeSuites += 1;
    let released = false;

    return async function releaseSuite() {
      if (released) return closePromise;
      released = true;
      activeSuites = Math.max(0, activeSuites - 1);
      if (activeSuites === 0 && !closePromise) {
        closePromise = Promise.resolve().then(() => closePool());
      }
      return closePromise;
    };
  }

  function getState() {
    return {
      activeSuites,
      closed: Boolean(closePromise)
    };
  }

  return {
    acquireSuite,
    getState
  };
}

const lifecycleKey = Symbol.for("forgeops.integration.poolLifecycle");
if (!globalThis[lifecycleKey]) {
  globalThis[lifecycleKey] = createSuitePoolLifecycle(() => pool.end());
}

export const integrationPoolLifecycle = globalThis[lifecycleKey];
