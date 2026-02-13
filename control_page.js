(() => {
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('status');
  const hostInput = document.getElementById('host');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');

  let timer = null;

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
    if (msg.action === 'likeManyResult' || msg.action === 'repostListResult' || msg.action === 'quoteListResult') {
      log('Result', msg.action, msg.result || msg);
    }
  });

  // auto-start on load
  start();
})();
