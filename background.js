chrome.runtime.onInstalled.addListener(() => {
  console.log('Custom Browser Automation Extension Installed');
});

// Accept a long-lived "keepAlive" port from the control page.
// Keeping a port open prevents the MV3 service worker from being suspended while the page is open.
chrome.runtime.onConnect.addListener(port => {
  try {
    if (port && port.name === 'keepAlive') {
      console.log('keepAlive port connected');
      port.onMessage.addListener(msg => {
        // respond to minimal heartbeats if requested
        if (msg && msg.ping) {
          try {
            port.postMessage({ pong: true });
          } catch (e) {
            console.warn('keepAlive postMessage failed:', e && e.message);
          }
        }
      });
      // create a periodic alarm as a fallback to wake the service worker
      try {
        // 1 minute is the minimum supported periodInMinutes for alarms
        chrome.alarms.create('keepAlivePing', { periodInMinutes: 1 });
        console.log('keepAlivePing alarm created');
      } catch (e) {
        console.warn('Failed to create keepAlive alarm:', e && e.message);
      }
      port.onDisconnect.addListener(() => {
        console.log('keepAlive port disconnected');
        try {
          chrome.alarms.clear('keepAlivePing');
        } catch (e) {}
      });
    }
  } catch (e) {
    console.warn('onConnect handler error:', e && e.message);
  }
});

// Alarm handler: wakes service worker periodically so it can perform light tasks or extend life
chrome.alarms &&
  chrome.alarms.onAlarm.addListener &&
  chrome.alarms.onAlarm.addListener(alarm => {
    try {
      if (!alarm) return;
      if (alarm.name === 'keepAlivePing') {
        console.log('keepAlivePing alarm fired');
        // no-op; the fact this handler runs means the worker was woken. Keep it short.
      }
    } catch (e) {
      console.warn('alarms.onAlarm handler error:', e && e.message);
    }
  });

// Helper to deliver results: prefer storage then runtime message; guard when storage unavailable
function deliverResult(storageKey, messageAction, res) {
  if (
    chrome &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.set === 'function'
  ) {
    try {
      chrome.storage.local.set({ [storageKey]: res }, () => {
        chrome.runtime.sendMessage({ action: messageAction, result: res }, () => {
          if (chrome.runtime.lastError)
            console.warn(messageAction + ' - no recipient:', chrome.runtime.lastError.message);
          else console.log(messageAction + ' delivered');
        });
      });
    } catch (e) {
      console.warn('deliverResult storage set failed:', e);
      try {
        chrome.runtime.sendMessage({ action: messageAction, result: res }, () => {});
      } catch (e2) {
        console.warn('deliverResult sendMessage failed:', e2);
      }
    }
  } else {
    // storage not available, attempt direct message
    try {
      chrome.runtime.sendMessage({ action: messageAction, result: res }, () => {
        if (chrome.runtime.lastError)
          console.warn(
            messageAction + ' - no recipient and storage unavailable:',
            chrome.runtime.lastError.message
          );
        else console.log(messageAction + ' delivered without storage');
      });
    } catch (e) {
      console.warn('deliverResult failed to send result:', e);
    }
  }
}

// Execute `chrome.scripting.executeScript` with retry logic to handle transient frame/navigation errors.
function executeScriptWithRetries(options, retries = 3, baseDelay = 300) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const run = () => {
      chrome.scripting.executeScript(options, results => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          const transient =
            /Frame with ID .* was removed|The message port closed|Could not establish connection/i.test(
              msg
            );
          if (transient && attempt < retries) {
            attempt++;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.warn(
              `executeScript transient error (attempt ${attempt}/${retries}):`,
              msg,
              '— retrying in',
              delay,
              'ms'
            );
            setTimeout(run, delay);
            return;
          }
          reject(new Error(msg));
        } else {
          resolve(results);
        }
      });
    };
    run();
  });
}

// Listener for commands from popup or other scripts
function handleRuntimeMessage(message, sender, sendResponse) {
  if (message.action === 'navigate') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ status: 'Navigated to ' + message.url });
  } else if (message.action === 'click') {
    const runClick = tabId => {
      executeScriptWithRetries({
        target: { tabId },
        func: () => {
          const likeButton = document.querySelector('div[data-testid="like"]');
          if (likeButton) {
            likeButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
            likeButton.click();
            console.log('Clicked a like button (from click action)');
          } else {
            console.warn('No like button found for click action');
          }
        },
      }).catch(err => console.error('executeScript (click) failed:', err && err.message));
    };

    if (sender && sender.tab && sender.tab.id) {
      runClick(sender.tab.id);
      sendResponse({ status: 'Clicked like button' });
    } else {
      // popup message or non-tab sender — find the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0];
        if (!tab) {
          sendResponse({ status: 'No active tab found' });
          return;
        }
        runClick(tab.id);
        sendResponse({ status: 'Clicked like button (active tab)' });
      });
      return true; // keep channel open for async sendResponse
    }
  } else if (message.action === 'likeMany') {
    const runOnTab = tabId => {
      return executeScriptWithRetries({
        target: { tabId },
        func: async (count, delaySeconds) => {
          console.log('likeMany injected, target count=', count);
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const delayMs = (delaySeconds || 30) * 1000;

          const getLikeButtons = () => {
            // Multi-strategy selector to handle varying DOM structures
            const candidates = [];

            // Strategy A: explicit data-testid="like"
            Array.from(
              document.querySelectorAll('div[data-testid="like"], [data-testid="like"]')
            ).forEach(el => {
              const btn = el.closest('div[role="button"], button') || el;
              if (btn && !candidates.some(c => c.btn === btn))
                candidates.push({ el, btn, reason: 'data-testid' });
            });

            // Strategy B: aria-label contains "Like" (case-insensitive)
            Array.from(document.querySelectorAll('[aria-label]')).forEach(el => {
              const label = el.getAttribute('aria-label') || '';
              if (/like/i.test(label)) {
                const btn = el.closest('div[role="button"], button') || el;
                if (btn && !candidates.some(c => c.btn === btn))
                  candidates.push({ el, btn, reason: 'aria-label' });
              }
            });

            // Strategy C: svg/title/desc contains "Like"
            Array.from(document.querySelectorAll('div[role="button"] svg, button svg')).forEach(
              svg => {
                const title =
                  svg.getAttribute('aria-label') ||
                  (svg.querySelector('title') && svg.querySelector('title').textContent) ||
                  '';
                if (/like/i.test(title)) {
                  const btn = svg.closest('div[role="button"], button');
                  if (btn && !candidates.some(c => c.btn === btn))
                    candidates.push({ el: svg, btn, reason: 'svg-title' });
                }
              }
            );

            console.log(
              'Found like candidates:',
              candidates.length,
              candidates.slice(0, 6).map(c => ({
                reason: c.reason,
                aria: c.btn && c.btn.getAttribute && c.btn.getAttribute('aria-label'),
                dataTest: c.el && c.el.getAttribute && c.el.getAttribute('data-testid'),
              }))
            );
            return candidates;
          };

          const findStatusUrl = node => {
            // Search up for an <a href=".../status/..."> link
            let cur = node;
            while (cur) {
              try {
                const a = cur.querySelector && cur.querySelector('a[href*="/status/"]');
                if (a && a.getAttribute) return a.href || location.origin + a.getAttribute('href');
              } catch (e) {
                // ignore cross-origin
              }
              cur = cur.parentElement;
            }
            // fallback: search entire document for first status link nearby
            const nearby = document.querySelector('a[href*="/status/"]');
            return nearby ? nearby.href || location.origin + nearby.getAttribute('href') : null;
          };

          const scrollDown = async () => {
            window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
            await wait(900 + Math.random() * 600);
          };

          let liked = 0;
          const likedUrls = [];
          const maxScrolls = 18;
          let scrollAttempts = 0;

          while (liked < count && scrollAttempts < maxScrolls) {
            const candidates = getLikeButtons();
            console.log('Candidates returned:', candidates.length, 'liked so far:', liked);
            for (const { el, btn } of candidates) {
              if (liked >= count) break;
              if (!btn) continue;

              try {
                // Ensure this is currently an unliked button (data-testid="like")
                const isUnliked =
                  el && el.getAttribute && el.getAttribute('data-testid') === 'like';
                if (!isUnliked) continue;

                btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                await wait(350 + Math.random() * 300);

                // Click and then verify change
                btn.click();
                await wait(500 + Math.random() * 600);

                const stillLike = el.getAttribute && el.getAttribute('data-testid') === 'like';
                const ariaPressed = btn.getAttribute && btn.getAttribute('aria-pressed');
                const becameLiked =
                  !stillLike ||
                  ariaPressed === 'true' ||
                  !!btn.querySelector('div[data-testid="unlike"]');

                if (becameLiked) {
                  // collect tweet url if possible
                  const url = findStatusUrl(btn) || findStatusUrl(el);
                  if (url) likedUrls.push(url);
                  liked++;
                  console.log('Successfully liked a tweet. Total liked:', liked, 'url:', url);
                } else {
                  console.warn('Click did not register as liked; skipping.');
                }

                // wait configured delay between actions to reduce automation detection
                await wait(delayMs + Math.random() * 2000);
              } catch (e) {
                console.warn('Error clicking like candidate:', e);
              }
            }

            if (liked >= count) break;
            await scrollDown();
            scrollAttempts++;
          }

          console.log('likeMany finished, liked:', liked, 'urls:', likedUrls);
          return { requested: count, liked, likedUrls };
        },
        args: [message.count || 5, message.delaySeconds || 30],
      })
        .then(results => {
          const res = results && results[0] && results[0].result;
          deliverResult('likeManyLastResult', 'likeManyResult', res);
        })
        .catch(err => {
          const res = { error: err && err.message };
          deliverResult('likeManyLastResult', 'likeManyResult', res);
        });
    };

    if (message.url) {
      chrome.tabs.create({ url: message.url }, tab => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            runOnTab(tab.id).finally(() => {
              if (!message.keepTab) chrome.tabs.remove(tab.id).catch(() => {});
            });
          }
        });
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0];
        if (!tab) {
          sendResponse({ status: 'No active tab found' });
          return;
        }
        runOnTab(tab.id);
      });
    }

    // We'll not respond immediately; the popup will receive the result via chrome.runtime.onMessage listener
    sendResponse({ status: 'likeMany started' });
    return true; // keep channel open for async response
  } else if (message.action === 'repostList') {
    // Open provided list URL (or use active tab) and repost (retweet) up to `count` tweets, returning the reposted URLs
    const listUrl = message.url || 'https://x.com/i/lists/1591905950507716608';
    const count = message.count || 5;

    chrome.tabs.create({ url: listUrl }, tab => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          console.log('Repost list tab ready:', tab.id, 'url:', listUrl);

          executeScriptWithRetries({
            target: { tabId: tab.id },
            func: async (count, delaySeconds) => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const delayMs = (delaySeconds || 30) * 1000;

              const getRetweetButtons = () => {
                const candidates = [];

                // Strategy A: data-testid
                Array.from(
                  document.querySelectorAll('[data-testid="retweet"], div[data-testid="retweet"]')
                ).forEach(el => {
                  const btn = el.closest('div[role="button"], button') || el;
                  if (btn && !candidates.some(c => c.btn === btn))
                    candidates.push({ el, btn, reason: 'data-testid' });
                });

                // Strategy B: aria-label contains 'Retweet'
                Array.from(document.querySelectorAll('[aria-label]')).forEach(el => {
                  const label = el.getAttribute('aria-label') || '';
                  if (/retweet/i.test(label)) {
                    const btn = el.closest('div[role="button"], button') || el;
                    if (btn && !candidates.some(c => c.btn === btn))
                      candidates.push({ el, btn, reason: 'aria-label' });
                  }
                });

                // Strategy C: svg/title contains 'Retweet'
                Array.from(document.querySelectorAll('div[role="button"] svg, button svg')).forEach(
                  svg => {
                    const title =
                      svg.getAttribute('aria-label') ||
                      (svg.querySelector('title') && svg.querySelector('title').textContent) ||
                      '';
                    if (/retweet/i.test(title)) {
                      const btn = svg.closest('div[role="button"], button');
                      if (btn && !candidates.some(c => c.btn === btn))
                        candidates.push({ el: svg, btn, reason: 'svg-title' });
                    }
                  }
                );

                return candidates;
              };

              const clickButtonByText = text => {
                const nodes = Array.from(
                  document.querySelectorAll('div[role="menuitem"], div[role="button"], button')
                );
                const match = nodes.find(
                  n =>
                    n.textContent &&
                    n.textContent.trim() &&
                    new RegExp('\\b' + text + '\\b', 'i').test(n.textContent.trim())
                );
                if (match) {
                  match.click();
                  return true;
                }
                return false;
              };

              const findStatusUrl = node => {
                let cur = node;
                while (cur) {
                  try {
                    const a = cur.querySelector && cur.querySelector('a[href*="/status/"]');
                    if (a && a.getAttribute)
                      return a.href || location.origin + a.getAttribute('href');
                  } catch (e) {}
                  cur = cur.parentElement;
                }
                const nearby = document.querySelector('a[href*="/status/"]');
                return nearby ? nearby.href || location.origin + nearby.getAttribute('href') : null;
              };

              let retweeted = 0;
              const retweetedUrls = [];
              const maxScrolls = 18;
              let scrollAttempts = 0;

              while (retweeted < count && scrollAttempts < maxScrolls) {
                const candidates = getRetweetButtons();
                console.log(
                  'Retweet candidates:',
                  candidates.length,
                  'retweeted so far:',
                  retweeted
                );

                for (const { el, btn } of candidates) {
                  if (retweeted >= count) break;
                  if (!btn) continue;
                  try {
                    // Skip if already retweeted (aria-pressed true)
                    const ariaPressed = btn.getAttribute && btn.getAttribute('aria-pressed');
                    if (ariaPressed === 'true') continue;

                    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await wait(350 + Math.random() * 400);

                    // Click the retweet icon (this usually opens a small menu)
                    btn.click();
                    await wait(400 + Math.random() * 400);

                    // Try to confirm the retweet/repost via menu options. X sometimes shows 'Repost' or 'Retweet' or 'Quote'.
                    let clickedConfirm = false;
                    const tryOptions = ['Repost', 'Retweet', 'Quote', 'Quote Tweet'];

                    // Helper to dispatch mouse events (more reliable than .click() in some cases)
                    const dispatchMouse = node => {
                      try {
                        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type =>
                          node.dispatchEvent(
                            new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                          )
                        );
                        return true;
                      } catch (e) {
                        try {
                          node.click();
                          return true;
                        } catch (e2) {
                          return false;
                        }
                      }
                    };

                    // Prefer searching inside visible menus/dialogs that pop up
                    const menus = Array.from(
                      document.querySelectorAll(
                        'div[role="menu"], div[role="dialog"], div[role="presentation"]'
                      )
                    );
                    const visibleMenu = menus.find(
                      m => m && (m.offsetParent !== null || m.getClientRects().length > 0)
                    );

                    if (visibleMenu) {
                      for (const opt of tryOptions) {
                        const match = Array.from(visibleMenu.querySelectorAll('*')).find(
                          n =>
                            n.textContent &&
                            new RegExp('\\b' + opt + '\\b', 'i').test(n.textContent.trim())
                        );
                        if (match) {
                          if (dispatchMouse(match)) {
                            console.log('Clicked menu option in visible menu:', opt);
                            clickedConfirm = true;
                            break;
                          }
                        }
                      }
                    }

                    if (!clickedConfirm) {
                      for (const opt of tryOptions) {
                        if (clickButtonByText(opt)) {
                          console.log('Clicked menu option (global search):', opt);
                          clickedConfirm = true;
                          break;
                        }
                      }
                    }

                    if (!clickedConfirm) {
                      // Fallback: search menu-like nodes for matching text and click
                      const menuNodes = Array.from(
                        document.querySelectorAll(
                          'div[role="menuitem"], div[role="menu"] button, div[role="menu"] div, button'
                        )
                      );
                      const match = menuNodes.find(
                        n =>
                          n.textContent &&
                          /\b(Repost|Retweet|Quote|Quote Tweet)\b/i.test(n.textContent.trim())
                      );
                      if (match) {
                        if (dispatchMouse(match)) {
                          clickedConfirm = true;
                          console.log(
                            'Clicked fallback menu node:',
                            match.textContent.trim().slice(0, 40)
                          );
                        } else
                          try {
                            match.click();
                            clickedConfirm = true;
                            console.log(
                              'Clicked fallback menu node via click():',
                              match.textContent.trim().slice(0, 40)
                            );
                          } catch (e) {
                            console.warn('Fallback menu click failed', e);
                          }
                      } else {
                        console.warn(
                          'No menu option found by text; menu nodes count:',
                          menuNodes.length
                        );
                      }
                    }

                    if (clickedConfirm) {
                      // wait for state change
                      await wait(500 + Math.random() * 600);
                    } else {
                      console.warn('No confirmation clicked after opening retweet menu');
                    }

                    // Verify retweeted by aria-pressed or changed button state
                    const nowAria = btn.getAttribute && btn.getAttribute('aria-pressed');
                    const becameRetweeted =
                      nowAria === 'true' ||
                      (!!btn.querySelector && !!btn.querySelector('[data-testid="unretweet"]')) ||
                      !btn.querySelector('[data-testid="retweet"]');

                    if (becameRetweeted) {
                      const url = findStatusUrl(btn) || findStatusUrl(el);
                      if (url) retweetedUrls.push(url);
                      retweeted++;
                      console.log('Retweeted a tweet. total:', retweeted, 'url:', url);
                    } else {
                      console.warn('Retweet click did not register; skipping');
                    }

                    // wait configured delay between actions to reduce automation detection
                    await wait(delayMs + Math.random() * 2000);
                  } catch (e) {
                    console.warn('Error processing retweet candidate:', e);
                  }
                }

                if (retweeted >= count) break;
                // scroll to load more
                window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
                await wait(900 + Math.random() * 600);
                scrollAttempts++;
              }

              console.log('repostList finished, retweeted:', retweeted, 'urls:', retweetedUrls);
              return { requested: count, retweeted, retweetedUrls };
            },
            args: [count, message.delaySeconds || 30],
          })
            .then(results => {
              const res = results && results[0] && results[0].result;
              console.log('repostList result:', res);
              deliverResult('repostListLastResult', 'repostListResult', res);
            })
            .catch(err => {
              const res = { error: err && err.message };
              deliverResult('repostListLastResult', 'repostListResult', res);
            })
            .finally(() => {
              if (!message.keepTab) chrome.tabs.remove(tab.id).catch(() => {});
            });
        }
      });
    });

    sendResponse({ status: 'repostList started' });
    return true;
  } else if (message.action === 'quoteList') {
    const listUrl = message.url || 'https://x.com/i/lists/1591905950507716608';
    // Detect if this is a single specific post URL (contains /status/)
    const isSinglePost = /\/status\/\d+/i.test(listUrl);
    // For single post, force count=1; otherwise use provided count or default 5
    const count = isSinglePost ? 1 : message.count || 5;
    const messages = message.messages && Array.isArray(message.messages) ? message.messages : [];

    chrome.tabs.create({ url: listUrl }, tab => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          console.log('Quote tab ready:', tab.id, 'url:', listUrl, 'isSinglePost:', isSinglePost);

          executeScriptWithRetries({
            target: { tabId: tab.id },
            func: async (count, messages, delaySeconds, isSinglePost) => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const delayMs = (delaySeconds || 30) * 1000;

              const getQuoteCandidates = () => {
                const candidates = [];

                if (isSinglePost) {
                  // For a single post page, ONLY target the main tweet's retweet button.
                  // The main tweet is the first article on the page (replies come after).
                  const mainArticle =
                    document.querySelector('article[data-testid="tweet"]') ||
                    document.querySelector('article');

                  if (mainArticle) {
                    // Check for unretweet first (already retweeted/quoted)
                    const unretweet = mainArticle.querySelector('[data-testid="unretweet"]');
                    if (unretweet) {
                      console.log('Single post: already retweeted/quoted — skipping');
                      return []; // return empty so it's skipped
                    }

                    const retweet = mainArticle.querySelector('[data-testid="retweet"]');
                    if (retweet) {
                      const btn = retweet.closest('div[role="button"], button') || retweet;
                      candidates.push({ el: retweet, btn, reason: 'single-post-retweet' });
                    } else {
                      // fallback: look for aria-label with retweet inside the main article
                      const ariaEl = mainArticle.querySelector(
                        '[aria-label*="Retweet" i], [aria-label*="repost" i]'
                      );
                      if (ariaEl) {
                        const btn = ariaEl.closest('div[role="button"], button') || ariaEl;
                        candidates.push({ el: ariaEl, btn, reason: 'single-post-aria' });
                      }
                    }
                  } else {
                    console.warn('Single post: no main article found on page');
                  }

                  console.log('Single post quote candidates:', candidates.length);
                  return candidates;
                }

                // --- List mode: find all retweet buttons on the page ---
                // Strategy A: data-testid="retweet" (primary)
                Array.from(
                  document.querySelectorAll('[data-testid="retweet"], div[data-testid="retweet"]')
                ).forEach(el => {
                  const btn = el.closest('div[role="button"], button') || el;
                  if (btn && !candidates.some(c => c.btn === btn))
                    candidates.push({ el, btn, reason: 'data-testid' });
                });

                // Strategy B: aria-label contains 'Retweet'
                Array.from(document.querySelectorAll('[aria-label]')).forEach(el => {
                  const label = el.getAttribute('aria-label') || '';
                  if (/retweet/i.test(label)) {
                    const btn = el.closest('div[role="button"], button') || el;
                    if (btn && !candidates.some(c => c.btn === btn))
                      candidates.push({ el, btn, reason: 'aria-label' });
                  }
                });

                // Strategy C: svg/title contains 'Retweet'
                Array.from(document.querySelectorAll('div[role="button"] svg, button svg')).forEach(
                  svg => {
                    const t =
                      svg.getAttribute('aria-label') ||
                      (svg.querySelector('title') && svg.querySelector('title').textContent) ||
                      '';
                    if (/retweet|repost/i.test(t)) {
                      const btn = svg.closest('div[role="button"], button');
                      if (btn && !candidates.some(c => c.btn === btn))
                        candidates.push({ el: svg, btn, reason: 'svg-title' });
                    }
                  }
                );

                console.log('Quote candidates:', candidates.length);
                return candidates;
              };

              const findStatusUrl = node => {
                let cur = node;
                while (cur) {
                  try {
                    const a = cur.querySelector && cur.querySelector('a[href*="/status/"]');
                    if (a && a.getAttribute)
                      return a.href || location.origin + a.getAttribute('href');
                  } catch (e) {}
                  cur = cur.parentElement;
                }
                const nearby = document.querySelector('a[href*="/status/"]');
                return nearby ? nearby.href || location.origin + nearby.getAttribute('href') : null;
              };

              const waitForComposer = async (timeoutMs = 8000) =>
                new Promise((resolve, reject) => {
                  const start = Date.now();
                  const timer = setInterval(() => {
                    const composer = document.querySelector(
                      'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                    );
                    if (composer) {
                      clearInterval(timer);
                      resolve(composer);
                      return;
                    }
                    if (Date.now() - start >= timeoutMs) {
                      clearInterval(timer);
                      reject(new Error('Composer timeout'));
                    }
                  }, 200);
                });

              const setComposerText = (el, text) => {
                // handle contenteditable
                try {
                  if (el.isContentEditable) {
                    el.focus();

                    // Better insertion for Unicode: use Range + TextNode to avoid any execCommand/encoding issues
                    try {
                      const sel = window.getSelection();
                      let range;
                      if (sel && sel.rangeCount) {
                        range = sel.getRangeAt(0);
                      } else {
                        range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                      }

                      // delete existing selection content
                      range.deleteContents();

                      const node = document.createTextNode(text);
                      range.insertNode(node);

                      // place caret after inserted node
                      range.setStartAfter(node);
                      range.collapse(true);
                      sel.removeAllRanges();
                      sel.addRange(range);

                      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                      console.log('Inserted text via Range/TextNode');
                      return true;
                    } catch (errRange) {
                      console.warn(
                        'Range/TextNode insertion failed, falling back to execCommand:',
                        errRange
                      );
                      document.execCommand('selectAll', false, null);
                      document.execCommand('insertText', false, text);
                      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                      return true;
                    }
                  }
                } catch (e) {
                  console.warn('execCommand failed:', e);
                }
                // fallback for textarea
                try {
                  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    el.value = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                  }
                } catch (e) {
                  console.warn('setting value failed:', e);
                }
                // last resort: set innerText
                try {
                  el.innerText = text;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                } catch (e) {
                  return false;
                }
              };

              const clickButtonByText = text => {
                const nodes = Array.from(
                  document.querySelectorAll(
                    'div[role="menuitem"], div[role="menu"] button, div[role="button"], button'
                  )
                );
                const match = nodes.find(
                  n =>
                    n.textContent &&
                    n.textContent.trim() &&
                    new RegExp('\\b' + text + '\\b', 'i').test(n.textContent.trim())
                );
                if (match) {
                  match.click();
                  return true;
                }
                return false;
              };

              // For single post, wait a bit more for the page to fully render
              if (isSinglePost) {
                await wait(2000 + Math.random() * 1000);

                // Check if already quoted/retweeted before doing anything
                const mainArticle =
                  document.querySelector('article[data-testid="tweet"]') ||
                  document.querySelector('article');
                if (mainArticle) {
                  const unretweet = mainArticle.querySelector('[data-testid="unretweet"]');
                  if (unretweet) {
                    console.log('Single post: already retweeted/quoted — aborting');
                    return {
                      requested: count,
                      quoted: 0,
                      quotedUrls: [],
                      alreadyQuoted: true,
                      message: 'This post was already quoted/retweeted',
                    };
                  }
                }
              }

              let quoted = 0;
              const quotedUrls = [];
              const maxScrolls = isSinglePost ? 0 : 18; // no scrolling for single post
              let scrollAttempts = 0;

              while (quoted < count && scrollAttempts <= maxScrolls) {
                const candidates = getQuoteCandidates();

                // For single post: if no candidates found, don't keep trying
                if (isSinglePost && candidates.length === 0) {
                  console.log('Single post: no retweet button found (may be already quoted)');
                  break;
                }

                for (let i = 0; i < candidates.length && quoted < count; i++) {
                  const { el, btn } = candidates[i];
                  if (!btn) continue;
                  try {
                    // Skip if already retweeted/quoted (aria-pressed true or unretweet present)
                    const ariaPressed = btn.getAttribute && btn.getAttribute('aria-pressed');
                    if (ariaPressed === 'true') {
                      console.log('Skipping candidate: aria-pressed=true (already retweeted)');
                      continue;
                    }

                    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await wait(300 + Math.random() * 400);
                    btn.click(); // open menu
                    await wait(300 + Math.random() * 500);

                    // find and click 'Quote' menu option
                    const quoteOptions = [
                      'Quote',
                      'Quote Tweet',
                      'Retweet with comment',
                      'Add a comment',
                    ];
                    let clicked = false;

                    const dispatchMouse = node => {
                      try {
                        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type =>
                          node.dispatchEvent(
                            new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                          )
                        );
                        return true;
                      } catch (e) {
                        try {
                          node.click();
                          return true;
                        } catch (e2) {
                          return false;
                        }
                      }
                    };

                    // prefer clicking inside visible menu/dialog
                    const menus = Array.from(
                      document.querySelectorAll(
                        'div[role="menu"], div[role="dialog"], div[role="presentation"]'
                      )
                    );
                    const visibleMenu = menus.find(
                      m => m && (m.offsetParent !== null || m.getClientRects().length > 0)
                    );
                    if (visibleMenu) {
                      for (const o of quoteOptions) {
                        const match = Array.from(visibleMenu.querySelectorAll('*')).find(
                          n =>
                            n.textContent &&
                            new RegExp('\\b' + o + '\\b', 'i').test(n.textContent.trim())
                        );
                        if (match) {
                          if (dispatchMouse(match)) {
                            clicked = true;
                            console.log('Clicked menu option in visible menu:', o);
                            break;
                          }
                        }
                      }
                    }

                    if (!clicked) {
                      for (const o of quoteOptions) {
                        if (clickButtonByText(o)) {
                          clicked = true;
                          console.log('Clicked menu option (global search):', o);
                          break;
                        }
                      }
                    }

                    if (!clicked) {
                      // fallback: try nodes in menus
                      const menuNodes = Array.from(
                        document.querySelectorAll(
                          'div[role="menuitem"], div[role="menu"] button, div[role="menu"] div'
                        )
                      );
                      const match = menuNodes.find(
                        n =>
                          n.textContent &&
                          /\b(Quote|Quote Tweet|Retweet with comment|Add a comment)\b/i.test(
                            n.textContent.trim()
                          )
                      );
                      if (match) {
                        try {
                          match.click();
                          clicked = true;
                          console.log('Clicked fallback menu node');
                        } catch (e) {
                          console.warn('fallback click failed', e);
                        }
                      }
                    }

                    if (!clicked) {
                      console.warn('No quote option found for candidate');
                      continue;
                    }

                    // Wait for composer
                    let composer;
                    try {
                      composer = await waitForComposer(8000);
                    } catch (e) {
                      console.warn('Composer did not appear:', e);
                      continue;
                    }

                    // set message (use provided messages[i] or messages[quoted] or empty)
                    const text = (messages && messages[i]) || (messages && messages[quoted]) || '';
                    console.log('Preparing to set composer text. JSON:', JSON.stringify(text));
                    try {
                      console.log('Text sample:', text.slice(0, 80));
                      console.log(
                        'Char codes:',
                        Array.from(text)
                          .slice(0, 40)
                          .map(c => c.charCodeAt(0))
                          .slice(0, 40)
                      );
                    } catch (e) {
                      console.warn('Text logging failed', e);
                    }
                    const ok = setComposerText(composer, text);
                    if (!ok) {
                      console.warn('Could not set composer text');
                    }

                    // Before clicking Post/Tweet, handle possible 'Who can reply?' dialog by choosing 'Everyone'
                    try {
                      const dialogs = Array.from(
                        document.querySelectorAll('div[role="dialog"], div[role="menu"]')
                      );
                      const whoDialog = dialogs.find(d =>
                        /Who can reply/i.test(d.textContent || '')
                      );
                      if (whoDialog) {
                        console.log(
                          'Who dialog detected (pre-click). Truncated HTML:',
                          whoDialog.outerHTML.slice(0, 500)
                        );
                        // Prefer aria-label if present, otherwise match text content; fallback to first selectable option
                        let everyoneBtn = whoDialog.querySelector(
                          '[aria-label*="Everyone" i], [aria-label*="everyone" i]'
                        );
                        if (!everyoneBtn) {
                          everyoneBtn = Array.from(
                            whoDialog.querySelectorAll('div[role="button"], button')
                          ).find(n =>
                            /Everyone/i.test(n.textContent || n.getAttribute('aria-label') || '')
                          );
                        }

                        if (everyoneBtn) {
                          try {
                            dispatchMouse(everyoneBtn);
                            console.log('Selected Everyone for Who can reply');
                          } catch (e) {
                            try {
                              everyoneBtn.click();
                              console.log('Clicked Everyone fallback');
                            } catch (e2) {
                              console.warn('Click Everyone fallback failed', e2);
                            }
                          }
                          await wait(300 + Math.random() * 300);
                        } else {
                          // fallback: click first option or radio-like candidate
                          const optionCandidates = Array.from(
                            whoDialog.querySelectorAll(
                              '[role="menuitem"], [role="menuitemradio"], div[role="button"], button, li'
                            )
                          ).filter(
                            n =>
                              n &&
                              n.offsetParent !== null &&
                              (n.textContent || '').trim().length > 0 &&
                              !/Who can reply|Choose who can reply/i.test(n.textContent || '')
                          );
                          if (optionCandidates.length) {
                            const opt = optionCandidates[0];
                            try {
                              dispatchMouse(opt);
                              console.log(
                                'Clicked first reply option (fallback):',
                                (opt.textContent || '').trim().slice(0, 60)
                              );
                            } catch (e) {
                              try {
                                opt.click();
                                console.log(
                                  'Clicked first reply option fallback via click:',
                                  (opt.textContent || '').trim().slice(0, 60)
                                );
                              } catch (e2) {
                                console.warn('Clicking first option failed', e2);
                              }
                            }
                            await wait(300 + Math.random() * 300);
                          } else {
                            console.warn(
                              'Everyone button not found and no option candidates in Who dialog (pre-click)'
                            );
                          }

                          // close dialog
                          const doneBtn = Array.from(
                            whoDialog.querySelectorAll('div[role="button"], button')
                          ).find(n => /Done|Apply|Close|Save|OK/i.test(n.textContent || ''));
                          if (doneBtn) {
                            try {
                              dispatchMouse(doneBtn);
                              console.log('Clicked Done/Apply to close Who dialog (pre-click)');
                            } catch (e) {
                              try {
                                doneBtn.click();
                                console.log('Clicked Done fallback (pre-click)');
                              } catch (e2) {
                                console.warn('Click Done fallback failed (pre-click)', e2);
                              }
                            }
                            await wait(200 + Math.random() * 300);
                          } else {
                            document.dispatchEvent(
                              new KeyboardEvent('keydown', {
                                key: 'Escape',
                                code: 'Escape',
                                bubbles: true,
                              })
                            );
                            document.dispatchEvent(
                              new KeyboardEvent('keyup', {
                                key: 'Escape',
                                code: 'Escape',
                                bubbles: true,
                              })
                            );
                            console.log('Sent Escape to close Who dialog (pre-click)');
                            await wait(200 + Math.random() * 300);
                          }
                        }
                      }
                    } catch (e) {
                      console.warn('Error handling Who can reply dialog (pre-click):', e);
                    }

                    // find Post/Tweet button inside the composer dialog (prefer local dialog scope)
                    const composerDialog =
                      composer && composer.closest ? composer.closest('div[role="dialog"]') : null;
                    let tweetBtn = null;
                    const btnMatcher = /\b(Tweet|Post|Reply|Retweet)\b/i;
                    if (composerDialog) {
                      tweetBtn = Array.from(
                        composerDialog.querySelectorAll('div[role="button"], button')
                      ).find(n => n.textContent && btnMatcher.test(n.textContent.trim()));
                    }
                    if (!tweetBtn) {
                      const tweetButtons = Array.from(
                        document.querySelectorAll('div[role="button"], button')
                      ).filter(n => n.textContent && btnMatcher.test(n.textContent.trim()));
                      tweetBtn =
                        tweetButtons.find(b => /Tweet|Post/i.test(b.textContent)) ||
                        tweetButtons[0];
                    }

                    if (tweetBtn) {
                      try {
                        // Try posting via Cmd/Ctrl+Enter (works reliably in manual test)
                        const sendKeyboardPost = async () => {
                          try {
                            composer.focus();
                          } catch (e) {}
                          await wait(50 + Math.random() * 50);

                          // Try Cmd+Enter (mac) first
                          try {
                            composer.dispatchEvent(
                              new KeyboardEvent('keydown', {
                                key: 'Enter',
                                metaKey: true,
                                bubbles: true,
                              })
                            );
                            composer.dispatchEvent(
                              new KeyboardEvent('keyup', {
                                key: 'Enter',
                                metaKey: true,
                                bubbles: true,
                              })
                            );
                            await wait(400 + Math.random() * 300);
                            const still = document.querySelector(
                              'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                            );
                            if (!still) return true;
                          } catch (e) {}

                          // Then try Ctrl+Enter
                          try {
                            composer.dispatchEvent(
                              new KeyboardEvent('keydown', {
                                key: 'Enter',
                                ctrlKey: true,
                                bubbles: true,
                              })
                            );
                            composer.dispatchEvent(
                              new KeyboardEvent('keyup', {
                                key: 'Enter',
                                ctrlKey: true,
                                bubbles: true,
                              })
                            );
                            await wait(400 + Math.random() * 300);
                            const still2 = document.querySelector(
                              'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                            );
                            if (!still2) return true;
                          } catch (e) {}

                          return false;
                        };

                        let posted = await sendKeyboardPost();

                        // If a Who can reply dialog blocks posting, select Everyone and retry keyboard post
                        if (!posted) {
                          const menus = Array.from(
                            document.querySelectorAll('div[role="dialog"], div[role="menu"]')
                          );
                          const whoDialog = menus.find(d =>
                            /Who can reply/i.test(d.textContent || '')
                          );
                          if (whoDialog) {
                            console.log(
                              'Who dialog detected. OuterHTML snapshot (truncated):',
                              whoDialog.outerHTML.slice(0, 800)
                            );
                            let everyoneBtn = Array.from(
                              whoDialog.querySelectorAll('div[role="button"], button')
                            ).find(n => /Everyone/i.test(n.textContent || ''));
                            if (everyoneBtn) {
                              try {
                                dispatchMouse(everyoneBtn);
                                console.log('Selected Everyone for Who can reply (auto)');
                              } catch (e) {
                                try {
                                  everyoneBtn.click();
                                  console.log('Clicked Everyone fallback');
                                } catch (e2) {
                                  console.warn('Click Everyone fallback failed', e2);
                                }
                              }
                              await wait(300 + Math.random() * 300);
                            } else {
                              // Fallback: select the first menu item or radio option inside the dialog (often the 'Everyone' option)
                              const optionCandidates = Array.from(
                                whoDialog.querySelectorAll(
                                  '[role="menuitem"], [role="menuitemradio"], div[role="button"], button, li'
                                )
                              ).filter(
                                n =>
                                  n &&
                                  n.offsetParent !== null &&
                                  (n.textContent || '').trim().length > 0 &&
                                  !/Who can reply|Choose who can reply/i.test(n.textContent || '')
                              );
                              if (optionCandidates.length) {
                                const opt = optionCandidates[0];
                                try {
                                  dispatchMouse(opt);
                                  console.log(
                                    'Clicked first reply option (fallback):',
                                    (opt.textContent || '').trim().slice(0, 60)
                                  );
                                } catch (e) {
                                  try {
                                    opt.click();
                                    console.log(
                                      'Clicked first reply option fallback via click:',
                                      (opt.textContent || '').trim().slice(0, 60)
                                    );
                                  } catch (e2) {
                                    console.warn('Clicking first option failed', e2);
                                  }
                                }
                                await wait(300 + Math.random() * 300);
                              } else {
                                console.warn(
                                  'Everyone button not found and no option candidates in Who dialog'
                                );
                              }

                              // After selecting, some UIs require clicking a 'Done' or 'Apply' button or pressing Escape
                              const doneBtn = Array.from(
                                whoDialog.querySelectorAll('div[role="button"], button')
                              ).find(n =>
                                /Done|Apply|Close|Save|Done|OK/i.test(n.textContent || '')
                              );
                              if (doneBtn) {
                                try {
                                  dispatchMouse(doneBtn);
                                  console.log('Clicked Done/Apply to close Who dialog');
                                } catch (e) {
                                  try {
                                    doneBtn.click();
                                    console.log('Clicked Done fallback');
                                  } catch (e2) {
                                    console.warn('Click Done fallback failed', e2);
                                  }
                                }
                                await wait(200 + Math.random() * 300);
                              } else {
                                // try closing with Escape
                                document.dispatchEvent(
                                  new KeyboardEvent('keydown', {
                                    key: 'Escape',
                                    code: 'Escape',
                                    bubbles: true,
                                  })
                                );
                                document.dispatchEvent(
                                  new KeyboardEvent('keyup', {
                                    key: 'Escape',
                                    code: 'Escape',
                                    bubbles: true,
                                  })
                                );
                                console.log('Sent Escape to close Who dialog');
                                await wait(200 + Math.random() * 300);
                              }

                              // verify who dialog closed
                              const stillWho = Array.from(
                                document.querySelectorAll('div[role="dialog"], div[role="menu"]')
                              ).find(d => /Who can reply/i.test(d.textContent || ''));
                              console.log('Who dialog still present?', !!stillWho);

                              // retry keyboard post
                              posted = await sendKeyboardPost();
                            }
                          } else {
                            console.log('No Who dialog detected when posting');
                          }
                        }

                        // Final fallback: click Post/Tweet button (robust click)
                        if (!posted) {
                          try {
                            if (tweetBtn) {
                              try {
                                tweetBtn.focus();
                              } catch (e) {}
                              try {
                                tweetBtn.click();
                              } catch (e) {
                                try {
                                  dispatchMouse(tweetBtn);
                                } catch (e2) {}
                              }
                              await wait(400 + Math.random() * 500);
                              const still3 = document.querySelector(
                                'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                              );
                              if (!still3) posted = true;
                            }

                            // If still not posted, try to find the composer-local definitive Post/Tweet button with multiple strategies
                            if (!posted) {
                              try {
                                const composerDialogLocal =
                                  composer && composer.closest
                                    ? composer.closest('div[role="dialog"]')
                                    : document;

                                // 1) Direct known data-testids (fast path)
                                const knownSelectors = [
                                  '[data-testid="tweetButton"]',
                                  '[data-testid="tweet-button"]',
                                  '[data-testid="tweet_submit"]',
                                  '[data-testid="toolBar"]',
                                  '[data-testid="tweetButtonInline"]',
                                ];
                                let postBtn = null;
                                for (const sel of knownSelectors) {
                                  const found =
                                    composerDialogLocal.querySelector(sel) ||
                                    document.querySelector(sel);
                                  if (found) {
                                    postBtn = found;
                                    console.log('Found post button by known selector:', sel);
                                    break;
                                  }
                                }

                                // 2) Prefer buttons with visible 'Post' or 'Tweet' text outside Who dialog
                                if (!postBtn) {
                                  const postCandidates = Array.from(
                                    (composerDialogLocal || document).querySelectorAll(
                                      'div[role="button"], button, [data-testid]'
                                    )
                                  );
                                  const isInsideWhoDialog = node => {
                                    let cur = node;
                                    while (cur) {
                                      try {
                                        if (
                                          /Who can reply|conversation-controls|conversation-controls-title/i.test(
                                            cur.textContent || cur.id || ''
                                          )
                                        )
                                          return true;
                                      } catch (e) {}
                                      cur = cur.parentElement;
                                    }
                                    return false;
                                  };
                                  const filteredCandidates = postCandidates.filter(
                                    n => n && !isInsideWhoDialog(n)
                                  );

                                  postBtn = filteredCandidates.find(
                                    n =>
                                      n &&
                                      n.textContent &&
                                      /\b(Post|Tweet)\b/i.test((n.textContent || '').trim())
                                  );
                                  if (!postBtn)
                                    postBtn = filteredCandidates.find(
                                      n =>
                                        n &&
                                        n.getAttribute &&
                                        /tweet|post|submit|send/i.test(
                                          n.getAttribute('data-testid') || ''
                                        )
                                    );
                                  if (!postBtn)
                                    postBtn = filteredCandidates.find(
                                      n =>
                                        n &&
                                        n.getAttribute &&
                                        /post|tweet|send/i.test(n.getAttribute('aria-label') || '')
                                    );
                                }

                                // 3) Last resort: find any visible button not inside Who dialog
                                if (!postBtn) {
                                  const allBtns = Array.from(
                                    (composerDialogLocal || document).querySelectorAll(
                                      'button, [role="button"]'
                                    )
                                  );
                                  const candidate = allBtns.find(
                                    n =>
                                      n &&
                                      n.offsetParent !== null &&
                                      !(
                                        n.closest &&
                                        n.closest(
                                          '[aria-labelledby="conversation-controls-title"],[aria-describedby="conversation-controls-details"]'
                                        )
                                      ) &&
                                      (n.textContent || '').trim().length > 0
                                  );
                                  if (candidate) {
                                    postBtn = candidate;
                                    console.log('Found post button by last-resort candidate');
                                  }
                                }

                                if (postBtn) {
                                  console.log(
                                    'Attempting definitive post button click. Text:',
                                    (postBtn.textContent || '').trim().slice(0, 40),
                                    'data-testid:',
                                    postBtn.getAttribute && postBtn.getAttribute('data-testid'),
                                    'aria-label:',
                                    postBtn.getAttribute && postBtn.getAttribute('aria-label')
                                  );
                                  try {
                                    postBtn.focus();
                                  } catch (e) {}
                                  try {
                                    postBtn.click();
                                  } catch (e) {
                                    try {
                                      dispatchMouse(postBtn);
                                    } catch (e2) {
                                      console.warn('Definitive post click failed', e2);
                                    }
                                  }
                                  await wait(500 + Math.random() * 500);
                                  const stillFinal = document.querySelector(
                                    'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                                  );
                                  if (!stillFinal) {
                                    posted = true;
                                    console.log('Definitive post button succeeded');
                                  } else {
                                    console.warn(
                                      'Definitive post button click did not close composer'
                                    );
                                    console.log(
                                      'Post button outerHTML (truncated):',
                                      (postBtn.outerHTML || '').slice(0, 400)
                                    );
                                  }
                                } else {
                                  console.warn(
                                    'No definitive post button candidate found in composer'
                                  );
                                }
                              } catch (e) {
                                console.warn('Error trying definitive post button:', e);
                              }
                            }
                          } catch (e) {
                            console.warn('Fallback click failed', e);
                          }
                        }

                        if (!posted) {
                          console.warn(
                            'Posting did not succeed after keyboard and click fallbacks; skipping candidate'
                          );
                          continue;
                        }
                      } catch (e) {
                        console.warn('Error posting quote:', e);
                        continue;
                      }
                      await wait(800 + Math.random() * 700);
                    } else {
                      console.warn('No post/tweet button found in composer');
                      continue;
                    }

                    // verify by checking composer closed or other state
                    await wait(500 + Math.random() * 500);
                    const url = findStatusUrl(btn) || findStatusUrl(el);
                    if (url) quotedUrls.push(url);
                    quoted++;
                    console.log('Quoted tweet. total:', quoted, 'orig url:', url);

                    // wait configured delay between actions to reduce automation detection
                    await wait(delayMs + Math.random() * 2000);
                  } catch (e) {
                    console.warn('Error quoting candidate:', e);
                  }
                }

                if (quoted >= count) break;

                // For single post, never scroll — we only care about the main tweet
                if (isSinglePost) {
                  console.log('Single post mode: not scrolling for more posts');
                  break;
                }

                window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
                await wait(900 + Math.random() * 600);
                scrollAttempts++;
              }

              console.log('quoteList finished, quoted:', quoted, 'urls:', quotedUrls);
              return { requested: count, quoted, quotedUrls };
            },
            args: [count, messages, message.delaySeconds || 30, isSinglePost],
          })
            .then(results => {
              const res = results && results[0] && results[0].result;
              console.log('quoteList result:', res);
              deliverResult('quoteListLastResult', 'quoteListResult', res);
            })
            .catch(err => {
              const res = { error: err && err.message };
              deliverResult('quoteListLastResult', 'quoteListResult', res);
            })
            .finally(() => {
              if (!message.keepTab) chrome.tabs.remove(tab.id).catch(() => {});
            });
        }
      });
    });

    sendResponse({ status: 'quoteList started' });
    return true;
  } else if (message.action === 'replyList') {
    const listUrl = message.url || 'https://x.com/i/lists/1591905950507716608';
    const isSinglePost = /\/status\/\d+/i.test(listUrl);
    const count = isSinglePost ? 1 : message.count || 5;
    const messages = message.messages && Array.isArray(message.messages) ? message.messages : [];

    chrome.tabs.create({ url: listUrl }, tab => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          console.log('Reply tab ready:', tab.id, 'url:', listUrl, 'isSinglePost:', isSinglePost);

          executeScriptWithRetries({
            target: { tabId: tab.id },
            func: async (count, messages, delaySeconds, isSinglePost) => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const delayMs = (delaySeconds || 30) * 1000;

              const getReplyCandidates = () => {
                const candidates = [];

                if (isSinglePost) {
                  const mainArticle =
                    document.querySelector('article[data-testid="tweet"]') ||
                    document.querySelector('article');
                  if (mainArticle) {
                    const reply = mainArticle.querySelector('[data-testid="reply"]');
                    if (reply) {
                      const btn = reply.closest('div[role="button"], button') || reply;
                      candidates.push({ el: reply, btn, reason: 'single-post-reply' });
                    } else {
                      const ariaEl = mainArticle.querySelector(
                        '[aria-label*="Reply" i], [aria-label*="reply" i]'
                      );
                      if (ariaEl) {
                        const btn = ariaEl.closest('div[role="button"], button') || ariaEl;
                        candidates.push({ el: ariaEl, btn, reason: 'single-post-aria' });
                      }
                    }
                  }
                  return candidates;
                }

                Array.from(
                  document.querySelectorAll('[data-testid="reply"], div[data-testid="reply"]')
                ).forEach(el => {
                  const btn = el.closest('div[role="button"], button') || el;
                  if (btn && !candidates.some(c => c.btn === btn))
                    candidates.push({ el, btn, reason: 'data-testid' });
                });

                Array.from(document.querySelectorAll('[aria-label]')).forEach(el => {
                  const label = el.getAttribute('aria-label') || '';
                  if (/reply/i.test(label)) {
                    const btn = el.closest('div[role="button"], button') || el;
                    if (btn && !candidates.some(c => c.btn === btn))
                      candidates.push({ el, btn, reason: 'aria-label' });
                  }
                });

                return candidates;
              };

              const findStatusUrl = node => {
                let cur = node;
                while (cur) {
                  try {
                    const a = cur.querySelector && cur.querySelector('a[href*="/status/"]');
                    if (a && a.getAttribute)
                      return a.href || location.origin + a.getAttribute('href');
                  } catch (e) {}
                  cur = cur.parentElement;
                }
                const nearby = document.querySelector('a[href*="/status/"]');
                return nearby ? nearby.href || location.origin + nearby.getAttribute('href') : null;
              };

              const waitForComposer = async (timeoutMs = 8000) =>
                new Promise((resolve, reject) => {
                  const start = Date.now();
                  const timer = setInterval(() => {
                    const composer = document.querySelector(
                      'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                    );
                    if (composer) {
                      clearInterval(timer);
                      resolve(composer);
                      return;
                    }
                    if (Date.now() - start >= timeoutMs) {
                      clearInterval(timer);
                      reject(new Error('Composer timeout'));
                    }
                  }, 200);
                });

              const setComposerText = (el, text) => {
                try {
                  if (el.isContentEditable) {
                    el.focus();
                    try {
                      const sel = window.getSelection();
                      let range;
                      if (sel && sel.rangeCount) {
                        range = sel.getRangeAt(0);
                      } else {
                        range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                      }
                      range.deleteContents();
                      const node = document.createTextNode(text);
                      range.insertNode(node);
                      range.setStartAfter(node);
                      range.collapse(true);
                      sel.removeAllRanges();
                      sel.addRange(range);
                      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                      return true;
                    } catch (errRange) {
                      try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, text);
                        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                        return true;
                      } catch (e) {
                        return false;
                      }
                    }
                  }
                } catch (e) {}
                try {
                  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    el.value = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                  }
                } catch (e) {}
                try {
                  el.innerText = text;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                } catch (e) {
                  return false;
                }
              };

              const clickButtonByText = text => {
                const nodes = Array.from(
                  document.querySelectorAll(
                    'div[role="menuitem"], div[role="menu"] button, div[role="button"], button'
                  )
                );
                const match = nodes.find(
                  n =>
                    n.textContent &&
                    n.textContent.trim() &&
                    new RegExp('\\b' + text + '\\b', 'i').test(n.textContent.trim())
                );
                if (match) {
                  match.click();
                  return true;
                }
                return false;
              };

              if (isSinglePost) {
                await wait(1500 + Math.random() * 800);
              }

              let replied = 0;
              const repliedUrls = [];
              const maxScrolls = isSinglePost ? 0 : 18;
              let scrollAttempts = 0;

              while (replied < count && scrollAttempts <= maxScrolls) {
                const candidates = getReplyCandidates();
                if (isSinglePost && candidates.length === 0) break;

                for (let i = 0; i < candidates.length && replied < count; i++) {
                  const { el, btn } = candidates[i];
                  if (!btn) continue;
                  try {
                    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await wait(300 + Math.random() * 400);
                    btn.click();
                    await wait(300 + Math.random() * 500);

                    let composer;
                    try {
                      composer = await waitForComposer(8000);
                    } catch (e) {
                      console.warn('Composer did not appear for reply:', e);
                      continue;
                    }

                    const text = (messages && messages[i]) || (messages && messages[replied]) || '';
                    const ok = setComposerText(composer, text);
                    if (!ok) {
                      console.warn('Could not set composer text for reply');
                    }

                    // handle Who can reply dialog similar to quote flow
                    try {
                      const dialogs = Array.from(
                        document.querySelectorAll('div[role="dialog"], div[role="menu"]')
                      );
                      const whoDialog = dialogs.find(d =>
                        /Who can reply/i.test(d.textContent || '')
                      );
                      if (whoDialog) {
                        let everyoneBtn = whoDialog.querySelector('[aria-label*="Everyone" i]');
                        if (!everyoneBtn) {
                          everyoneBtn = Array.from(
                            whoDialog.querySelectorAll('div[role="button"], button')
                          ).find(n =>
                            /Everyone/i.test(n.textContent || n.getAttribute('aria-label') || '')
                          );
                        }
                        if (everyoneBtn) {
                          try {
                            everyoneBtn.click();
                          } catch (e) {}
                          await wait(300 + Math.random() * 300);
                        }
                        const doneBtn = Array.from(
                          whoDialog.querySelectorAll('div[role="button"], button')
                        ).find(n => /Done|Apply|Close|Save|OK/i.test(n.textContent || ''));
                        if (doneBtn) {
                          try {
                            doneBtn.click();
                          } catch (e) {}
                          await wait(200 + Math.random() * 300);
                        }
                      }
                    } catch (e) {
                      console.warn('Error handling Who dialog (reply):', e);
                    }

                    // post the reply
                    let posted = false;
                    try {
                      composer.focus();
                    } catch (e) {}
                    // try Cmd/Ctrl+Enter
                    try {
                      composer.dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
                      );
                      composer.dispatchEvent(
                        new KeyboardEvent('keyup', { key: 'Enter', metaKey: true, bubbles: true })
                      );
                      await wait(400 + Math.random() * 300);
                      const still = document.querySelector(
                        'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                      );
                      if (!still) posted = true;
                    } catch (e) {}

                    if (!posted) {
                      try {
                        composer.dispatchEvent(
                          new KeyboardEvent('keydown', {
                            key: 'Enter',
                            ctrlKey: true,
                            bubbles: true,
                          })
                        );
                        composer.dispatchEvent(
                          new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true, bubbles: true })
                        );
                        await wait(400 + Math.random() * 300);
                        const still2 = document.querySelector(
                          'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                        );
                        if (!still2) posted = true;
                      } catch (e) {}
                    }

                    if (!posted) {
                      // try clicking Post/Tweet/Reply button
                      const composerDialog =
                        composer && composer.closest
                          ? composer.closest('div[role="dialog"]')
                          : null;
                      let postBtn = null;
                      const btnMatcher = /\b(Reply|Post|Tweet)\b/i;
                      if (composerDialog) {
                        postBtn = Array.from(
                          composerDialog.querySelectorAll('div[role="button"], button')
                        ).find(n => n.textContent && btnMatcher.test(n.textContent.trim()));
                      }
                      if (!postBtn) {
                        const tweetButtons = Array.from(
                          document.querySelectorAll('div[role="button"], button')
                        ).filter(n => n.textContent && btnMatcher.test(n.textContent.trim()));
                        postBtn =
                          tweetButtons.find(b => /Reply|Tweet|Post/i.test(b.textContent)) ||
                          tweetButtons[0];
                      }
                      if (postBtn) {
                        try {
                          postBtn.click();
                        } catch (e) {
                          try {
                            postBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                          } catch (e2) {}
                        }
                        await wait(400 + Math.random() * 500);
                        const still3 = document.querySelector(
                          'div[role="dialog"] [role="textbox"], div[role="textbox"][data-testid], textarea'
                        );
                        if (!still3) posted = true;
                      }
                    }

                    if (!posted) {
                      console.warn('Posting reply did not succeed; skipping candidate');
                      continue;
                    }

                    await wait(800 + Math.random() * 700);
                    const url = findStatusUrl(btn) || findStatusUrl(el);
                    if (url) repliedUrls.push(url);
                    replied++;
                    await wait(delayMs + Math.random() * 2000);
                  } catch (e) {
                    console.warn('Error replying to candidate:', e);
                  }
                }

                if (replied >= count) break;
                if (isSinglePost) break;
                window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
                await wait(900 + Math.random() * 600);
                scrollAttempts++;
              }

              return { requested: count, replied, repliedUrls };
            },
            args: [count, messages, message.delaySeconds || 30, isSinglePost],
          })
            .then(results => {
              const res = results && results[0] && results[0].result;
              console.log('replyList result:', res);
              deliverResult('replyListLastResult', 'replyListResult', res);
            })
            .catch(err => {
              const res = { error: err && err.message };
              deliverResult('replyListLastResult', 'replyListResult', res);
            })
            .finally(() => {
              if (!message.keepTab) chrome.tabs.remove(tab.id).catch(() => {});
            });
        }
      });
    });

    sendResponse({ status: 'replyList started' });
    return true;
  }
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

// Function to navigate to x.com and log in
function loginToXCom(username, password) {
  chrome.tabs.create({ url: 'https://x.com/login' }, tab => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener); // Remove the listener after the tab is loaded
        console.log('Login tab ready:', tab.id);

        // wait a short moment to allow dynamic content to render before injecting
        setTimeout(() => {
          executeScriptWithRetries({
            target: { tabId: tab.id },
            func: async (username, password) => {
              console.log('Script injected into the page');

              const waitForSelector = (selector, timeoutMs = 15000) =>
                new Promise((resolve, reject) => {
                  const start = Date.now();
                  const timer = setInterval(() => {
                    const element = document.querySelector(selector);
                    if (element) {
                      clearInterval(timer);
                      resolve(element);
                      return;
                    }
                    if (Date.now() - start >= timeoutMs) {
                      clearInterval(timer);
                      reject(new Error(`Timeout waiting for ${selector}`));
                    }
                  }, 200);
                });

              const clickIfExists = selector => {
                const button = document.querySelector(selector);
                if (!button) return false;
                button.click();
                return true;
              };

              const setNativeValue = (element, value) => {
                const valueSetter = Object.getOwnPropertyDescriptor(
                  element.__proto__,
                  'value'
                )?.set;
                const prototype = Object.getPrototypeOf(element);
                const prototypeValueSetter = Object.getOwnPropertyDescriptor(
                  prototype,
                  'value'
                )?.set;
                if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
                  prototypeValueSetter.call(element, value);
                } else if (valueSetter) {
                  valueSetter.call(element, value);
                } else {
                  element.value = value;
                }
              };

              const triggerInputEvents = element => {
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(
                  new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
                );
              };

              const clickButtonByText = text => {
                const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
                const button = buttons.find(
                  node => node.textContent && node.textContent.trim() === text
                );
                if (!button) return false;
                button.click();
                return true;
              };

              const pressEnter = element => {
                element.focus();
                element.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
                );
                element.dispatchEvent(
                  new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
                );
              };

              try {
                // Try multiple possible selectors and heuristics for the username input since the login page can vary.
                const usernameSelectors = [
                  'input[name="text"]',
                  'input[name="session[username_or_email]"]',
                  'input[name="username"]',
                  'input[autocomplete="username"]',
                  'input[type="text"]',
                  'input[aria-label]',
                ];
                let usernameField = null;
                let foundSelector = null;
                // per-selector timeout increased to 20000ms to account for dynamic rendering
                for (const sel of usernameSelectors) {
                  try {
                    usernameField = await waitForSelector(sel, 20000);
                    if (usernameField) {
                      foundSelector = sel;
                      break;
                    }
                  } catch (e) {
                    // ignore and try next selector
                  }
                }

                // If we still haven't found an input, try heuristics: role=textbox, aria-label keywords, visible placeholders, and contenteditable
                if (!usernameField) {
                  // log available button texts to help debugging
                  try {
                    const buttons = Array.from(
                      document.querySelectorAll('div[role="button"], button')
                    ).map(b => ({
                      text: (b.textContent || '').trim(),
                      role: b.getAttribute('role'),
                    }));
                    console.log('Buttons on page:', buttons.slice(0, 30));
                  } catch (e) {
                    /* ignore */
                  }

                  const roleTextbox = Array.from(
                    document.querySelectorAll('[role="textbox"]')
                  ).find(el => el.offsetParent !== null);
                  if (roleTextbox) {
                    usernameField = roleTextbox;
                    foundSelector = '[role="textbox"]';
                  }

                  if (!usernameField) {
                    const ariaMatch = Array.from(
                      document.querySelectorAll('input[aria-label]')
                    ).find(
                      i =>
                        /user|email|phone|username|account|login/i.test(
                          i.getAttribute('aria-label')
                        ) && i.offsetParent !== null
                    );
                    if (ariaMatch) {
                      usernameField = ariaMatch;
                      foundSelector = 'input[aria-label~=username]';
                    }
                  }

                  if (!usernameField) {
                    const placeholderMatch = Array.from(
                      document.querySelectorAll('input[placeholder]')
                    ).find(
                      i =>
                        /user|email|phone|username|account|login/i.test(
                          i.getAttribute('placeholder')
                        ) && i.offsetParent !== null
                    );
                    if (placeholderMatch) {
                      usernameField = placeholderMatch;
                      foundSelector = 'input[placeholder]';
                    }
                  }

                  if (!usernameField) {
                    const contentEditable = Array.from(
                      document.querySelectorAll('[contenteditable="true"]')
                    ).find(el => el.offsetParent !== null);
                    if (contentEditable) {
                      usernameField = contentEditable;
                      foundSelector = 'contenteditable';
                    }
                  }
                }
                if (!usernameField) {
                  throw new Error(
                    'Timeout waiting for username field (tried selectors: ' +
                      usernameSelectors.join(',') +
                      ')'
                  );
                }
                console.log('Found username field using selector:', foundSelector);
                // Diagnostics: print page URL and a short summary of input elements available
                try {
                  console.log('Page URL (injected):', location.href);
                  const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
                    name: i.getAttribute('name'),
                    type: i.type,
                    autocomplete: i.getAttribute('autocomplete'),
                  }));
                  console.log('Inputs on page:', inputs);
                } catch (diagErr) {
                  console.warn('Diagnostics failed:', diagErr);
                }
                setNativeValue(usernameField, username);
                triggerInputEvents(usernameField);
                console.log('Username filled');

                const nextSelector = 'div[role="button"][data-testid="LoginForm_Next_Button"]';
                try {
                  await waitForSelector(nextSelector, 8000);
                  console.log('Next selector appeared (or became available)');
                } catch (error) {
                  console.warn('Next button not found by selector, trying text match');
                }

                const clickedNext = clickIfExists(nextSelector) || clickButtonByText('Next');

                if (!clickedNext) {
                  // Some flows show a login button on the first step
                  const clickedLogin =
                    clickIfExists('div[role="button"][data-testid="LoginForm_Login_Button"]') ||
                    clickButtonByText('Log in');

                  if (!clickedLogin) {
                    // Fallback: submit with Enter
                    pressEnter(usernameField);
                  }
                }

                const passwordField = await waitForSelector('input[name="password"]');
                passwordField.value = password;
                passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('Password filled');

                const clickedLogin = clickIfExists(
                  'div[role="button"][data-testid="LoginForm_Login_Button"]'
                );
                if (!clickedLogin) {
                  console.error('Login button not found');
                }
              } catch (error) {
                console.error('Login automation failed:', error);
              }
            },
            args: [username, password],
          })
            .then(() => {
              console.log('executeScript completed');
            })
            .catch(err => {
              console.error('executeScript failed:', err);
              try {
                if (err && err.stack) console.error(err.stack);
              } catch (e) {
                // ignore
              }
            });
        }, 3000);
      }
    });
  });
}

// Example usage (disabled; run manually if needed)
// const username = 'RMenila1281';
// const password = '1QSR@sTOEXXaOmK!';
// loginToXCom(username, password);

// Poll a local server for commands (e.g. http://127.0.0.1:6060)
// The server should provide GET /next which returns the next queued command as JSON
// Example returned JSON: { id: "uuid", action: "likeMany", count: 5, url: "https://x.com/..." }
function startLocalCommandPolling(options = {}) {
  const host = options.host || 'http://127.0.0.1:6060';
  const intervalMs = options.intervalMs || 2000;

  async function pollOnce() {
    try {
      const res = await fetch(host + '/next', { cache: 'no-store' });
      if (!res.ok) return;
      const obj = await res.json();
      if (!obj || Object.keys(obj).length === 0 || obj.empty) return;

      console.log('Local command received:', obj);

      try {
        handleRuntimeMessage(obj, null, reply => {
          console.log('Local command processed, reply:', reply);
        });
      } catch (handlerError) {
        console.warn('Local command handler threw', handlerError);
      }
    } catch (e) {
      // local server may be down; ignore temporarily
    }
  }

  const id = setInterval(pollOnce, intervalMs);
  pollOnce();
  console.log('Started local command polling to', host, 'every', intervalMs, 'ms');
  return () => clearInterval(id);
}

// Start polling by default (adjust host/interval as needed)
startLocalCommandPolling({ host: 'http://127.0.0.1:6060', intervalMs: 2000 });
