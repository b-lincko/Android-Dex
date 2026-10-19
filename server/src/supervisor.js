/**
 * Connection supervisor: state machine, exponential backoff with jitter,
 * session restoration and a health score.
 *
 * States: connected → dropping → reconnecting → restoring → connected
 *         (or cancelled / offline when auto-reconnect is disabled)
 */
import { backoffDelay } from './util.js';

export function createSupervisor(runtime) {
  const { state } = runtime;
  let timer = null;
  let restoreTimer = null;
  let healthTimer = null;

  const setState = (patch) => {
    state.reconnect = { ...state.reconnect, ...patch };
    runtime.emit('reconnect.state', state.reconnect);
    return state.reconnect;
  };

  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (restoreTimer) clearTimeout(restoreTimer);
    timer = null;
    restoreTimer = null;
  };

  const restoreSession = () => {
    const device = runtime.activeDevice();
    if (!device) return setState({ state: 'offline', restored: 0 });
    const openWindows = state.windows.filter((win) => win.state === 'running');
    // Re-launch order is preserved by z-index so the user's stack looks the same.
    const order = [...openWindows].sort((a, b) => a.z - b.z).map((win) => win.appId);
    const restored = order.length;
    device.status = 'connected';
    device.lastSeen = new Date().toISOString();
    runtime.emit('reconnect.restored', { deviceId: device.id, apps: order, restored });
    runtime.audit('reconnect.restored', `${restored} windows`);
    return setState({
      state: 'connected', attempt: 0, nextRetryAt: null, restored,
      healthScore: Math.min(100, state.reconnect.healthScore + 4),
    });
  };

  const attempt = () => {
    timer = null;
    const device = runtime.activeDevice();
    if (!device) return setState({ state: 'offline' });
    const attemptNumber = state.reconnect.attempt + 1;
    const delay = backoffDelay(attemptNumber, state.settings.reconnectBackoff || {});
    if (attemptNumber > 20) {
      return setState({ state: 'offline', lastReason: 'retry budget exhausted', attempt: attemptNumber, nextRetryAt: null });
    }
    setState({ state: 'reconnecting', attempt: attemptNumber, nextRetryAt: new Date(Date.now() + delay).toISOString() });
    device.status = 'reconnecting';
    timer = setTimeout(() => {
      // A real supervisor probes `adb get-state` + a companion ping here. The
      // bridge treats a wake event or an explicit reconnectNow() as success.
      const current = runtime.activeDevice();
      if (!current) return setState({ state: 'offline' });
      if (current.status === 'connected') {
        setState({ state: 'restoring' });
        restoreTimer = setTimeout(restoreSession, 250);
        return;
      }
      if (state.reconnect.attempt < 20 && state.settings.autoReconnect) {
        attempt();
      } else {
        setState({ state: 'offline', nextRetryAt: null });
      }
    }, delay);
    timer.unref?.();
  };

  const supervisor = {
    status() {
      return { ...state.reconnect, autoReconnect: state.settings.autoReconnect, deviceStatus: runtime.activeDevice()?.status || 'offline' };
    },

    drop(reason = 'transport lost') {
      clearTimers();
      const device = runtime.activeDevice();
      if (device) device.status = 'reconnecting';
      state.reconnect.totalDrops += 1;
      state.reconnect.healthScore = Math.max(0, state.reconnect.healthScore - 15);
      state.reconnect.lastDropAt = new Date().toISOString();
      runtime.emit('reconnect.dropped', { reason, totalDrops: state.reconnect.totalDrops });
      runtime.audit('reconnect.dropped', reason, 'connection');
      if (!state.settings.autoReconnect) {
        return setState({ state: 'offline', lastReason: reason, nextRetryAt: null });
      }
      setState({ state: 'dropping', lastReason: reason, attempt: 0 });
      timer = setTimeout(attempt, 250);
      timer.unref?.();
      return state.reconnect;
    },

    reconnectNow() {
      clearTimers();
      const device = runtime.activeDevice();
      if (device) device.status = 'connected';
      runtime.emit('reconnect.manual', {});
      setState({ state: 'restoring', attempt: 0, nextRetryAt: null });
      restoreTimer = setTimeout(restoreSession, 200);
      restoreTimer.unref?.();
      return state.reconnect;
    },

    cancel() {
      clearTimers();
      return setState({ state: 'offline', nextRetryAt: null });
    },

    /** Backoff preview used by the UI and docs. */
    preview(attempts = 8) {
      const config = state.settings.reconnectBackoff || {};
      return Array.from({ length: attempts }, (_, index) => ({
        attempt: index + 1,
        delayMs: backoffDelay(index + 1, { ...config, jitter: 0 }),
        jitteredUpToMs: backoffDelay(index + 1, config),
      }));
    },

    start() {
      if (healthTimer) clearInterval(healthTimer);
      healthTimer = setInterval(() => {
        const device = runtime.activeDevice();
        const connected = device?.status === 'connected';
        if (connected) {
          state.reconnect.healthScore = Math.min(100, state.reconnect.healthScore + 1);
          const lastSeen = new Date(device.lastSeen || 0).getTime();
          if (Date.now() - lastSeen > 120_000 && state.reconnect.state === 'connected') {
            supervisor.drop('heartbeat timeout');
          }
        }
      }, 15_000);
      healthTimer.unref?.();
      return () => clearInterval(healthTimer);
    },

    stop() {
      clearTimers();
      if (healthTimer) clearInterval(healthTimer);
      healthTimer = null;
    },
  };

  return supervisor;
}
