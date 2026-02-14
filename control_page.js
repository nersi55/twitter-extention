(() => {
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('status');
  const hostInput = document.getElementById('host');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');

  let timer = null;
  let keepAlivePort = null;
  let keepAliveInterval = null;

  const log = (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    logEl.textContent = line + logEl.textContent;
  };

  async function fetchNext(host) {
    try {
      const res = await fetch(host + '/next', { cache: 'no-store' });
      if (!res.ok) {
        log('next fetch failed status', res.status);
        return null;
      }
      const obj = await res.json();
      if (!obj || Object.keys(obj).length === 0 || obj.empty) return null;
      return obj;
    } catch (e) {
      log('next fetch error', e.message || e);
      return null;
    }
  }

  async function reenqueue(host, payload) {
    try {
      await fetch(host + '/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      log('Re-enqueued command after delivery failure');
    } catch (e) {
      log('Failed to re-enqueue command', e.message || e);
    }
  }

  function poll() {
    const host = hostInput.value.trim().replace(/\/$/, '');
    fetchNext(host).then(obj => {
      if (!obj) return;
      log('Local command received', obj);
      chrome.runtime.sendMessage(obj, reply => {
        const err = chrome.runtime.lastError;
        if (err) {
          log('Delivery error', err.message);
          // push back into queue so it is not lost
          reenqueue(host, obj);
          return;
        }
        log('Command processed reply', reply);
      });
    });
  }

  // Open a persistent port to keep the MV3 service worker alive while this page is open.
  function ensureKeepAlive() {
    try {
      if (keepAlivePort) return;
      keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
      keepAlivePort.onDisconnect.addListener(() => {
        log('keepAlive port disconnected');
        keepAlivePort = null;
        // attempt reconnect after short delay
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        setTimeout(ensureKeepAlive, 2000);
      });
      keepAlivePort.onMessage.addListener(msg => {
        // no-op: just keep the port active; optionally log minimal heartbeats
        if (msg && msg.ping) log('keepAlive pong');
      });
      // send periodic pings to ensure activity and detect disconnects
      keepAliveInterval = setInterval(() => {
        try {
          if (keepAlivePort) keepAlivePort.postMessage({ ping: true });
        } catch (e) {
          log('keepAlive post failed', e && e.message);
        }
      }, 20000);
      log('keepAlive port opened');
    } catch (e) {
      log('Failed to open keepAlive port', e && e.message);
      keepAlivePort = null;
    }
  }

  // Clean up port when page unloads
  window.addEventListener('beforeunload', () => {
    try {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (keepAlivePort) keepAlivePort.disconnect();
    } catch (e) {}
  });

  function start() {
    if (timer) return;
    statusEl.textContent = 'Polling...';
    poll();
    timer = setInterval(poll, 2000);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    statusEl.textContent = 'Stopped';
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);

  // Listen for result messages so background.js deliverResult has a recipient
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || !msg.action) return;
    if (
        msg.action === 'likeManyResult' ||
        msg.action === 'repostListResult' ||
        msg.action === 'quoteListResult' ||
        msg.action === 'replyListResult'
      ) {
      log('Result', msg.action, msg.result || msg);
    }
  });

  // auto-start on load
  // open keep-alive port then start polling
  ensureKeepAlive();
  start();
})();
