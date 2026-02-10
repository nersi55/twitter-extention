chrome.runtime.onInstalled.addListener(() => {
  console.log("Custom Browser Automation Extension Installed");
});

// Listener for commands from popup or other scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "navigate") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ status: "Navigated to " + message.url });
  } else if (message.action === "click") {
    const runClick = (tabId) => {
      chrome.scripting.executeScript({
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
        }
      }, () => {
        if (chrome.runtime.lastError) console.error('executeScript (click) failed:', chrome.runtime.lastError.message);
      });
    };

    if (sender && sender.tab && sender.tab.id) {
      runClick(sender.tab.id);
      sendResponse({ status: "Clicked like button" });
    } else {
      // popup message or non-tab sender — find the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) {
          sendResponse({ status: "No active tab found" });
          return;
        }
        runClick(tab.id);
        sendResponse({ status: "Clicked like button (active tab)" });
      });
      return true; // keep channel open for async sendResponse
    }
  } else if (message.action === "likeMany") {
    // Like up to `count` unliked tweets on the active tab, scrolling to load more if needed
    // NOTE: we'll respond asynchronously (call sendResponse when finished) so keep channel open
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (count) => {
          console.log('likeMany injected, target count=', count);
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));

          const getLikeButtons = () => {
            // Multi-strategy selector to handle varying DOM structures
            const candidates = [];

            // Strategy A: explicit data-testid="like"
            Array.from(document.querySelectorAll('div[data-testid="like"], [data-testid="like"]')).forEach((el) => {
              const btn = el.closest('div[role="button"], button') || el;
              if (btn && !candidates.some(c => c.btn === btn)) candidates.push({ el, btn, reason: 'data-testid' });
            });

            // Strategy B: aria-label contains "Like" (case-insensitive)
            Array.from(document.querySelectorAll('[aria-label]')).forEach((el) => {
              const label = (el.getAttribute('aria-label') || '');
              if (/like/i.test(label)) {
                const btn = el.closest('div[role="button"], button') || el;
                if (btn && !candidates.some(c => c.btn === btn)) candidates.push({ el, btn, reason: 'aria-label' });
              }
            });

            // Strategy C: svg/title/desc contains "Like"
            Array.from(document.querySelectorAll('div[role="button"] svg, button svg')).forEach((svg) => {
              const title = (svg.getAttribute('aria-label') || (svg.querySelector('title') && svg.querySelector('title').textContent) || '');
              if (/like/i.test(title)) {
                const btn = svg.closest('div[role="button"], button');
                if (btn && !candidates.some(c => c.btn === btn)) candidates.push({ el: svg, btn, reason: 'svg-title' });
              }
            });

            console.log('Found like candidates:', candidates.length, candidates.slice(0, 6).map(c => ({ reason: c.reason, aria: c.btn && c.btn.getAttribute && c.btn.getAttribute('aria-label'), dataTest: c.el && c.el.getAttribute && c.el.getAttribute('data-testid') })));
            return candidates;
          };

          const findStatusUrl = (node) => {
            // Search up for an <a href=".../status/..."> link
            let cur = node;
            while (cur) {
              try {
                const a = cur.querySelector && cur.querySelector('a[href*="/status/"]');
                if (a && a.getAttribute) return a.href || (location.origin + a.getAttribute('href'));
              } catch (e) {
                // ignore cross-origin
              }
              cur = cur.parentElement;
            }
            // fallback: search entire document for first status link nearby
            const nearby = document.querySelector('a[href*="/status/"]');
            return nearby ? (nearby.href || (location.origin + nearby.getAttribute('href'))) : null;
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
                const isUnliked = el && el.getAttribute && el.getAttribute('data-testid') === 'like';
                if (!isUnliked) continue;

                btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                await wait(350 + Math.random() * 300);

                // Click and then verify change
                btn.click();
                await wait(500 + Math.random() * 600);

                const stillLike = el.getAttribute && el.getAttribute('data-testid') === 'like';
                const ariaPressed = btn.getAttribute && btn.getAttribute('aria-pressed');
                const becameLiked = !stillLike || ariaPressed === 'true' || !!btn.querySelector('div[data-testid="unlike"]');

                if (becameLiked) {
                  // collect tweet url if possible
                  const url = findStatusUrl(btn) || findStatusUrl(el);
                  if (url) likedUrls.push(url);
                  liked++;
                  console.log('Successfully liked a tweet. Total liked:', liked, 'url:', url);
                } else {
                  console.warn('Click did not register as liked; skipping.');
                }

                await wait(300 + Math.random() * 400);
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
        args: [message.count || 5],
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.error('executeScript failed:', chrome.runtime.lastError.message);
          // send back error
          try { chrome.runtime.sendMessage({ action: 'likeManyResult', error: chrome.runtime.lastError.message }); } catch (e) {}
        } else {
          const res = results && results[0] && results[0].result;
          console.log('likeMany result:', res);
          try { chrome.runtime.sendMessage({ action: 'likeManyResult', result: res }); } catch (e) {}
        }
      });
    });

    // We'll not respond immediately; the popup will receive the result via chrome.runtime.onMessage listener
    sendResponse({ status: 'likeMany started' });
    return true; // keep channel open for async response
  }
});

// Function to navigate to x.com and log in
function loginToXCom(username, password) {
  chrome.tabs.create({ url: 'https://x.com/login' }, (tab) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener); // Remove the listener after the tab is loaded
        console.log('Login tab ready:', tab.id);

        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (username, password) => {
            console.log('Script injected into the page');

            const waitForSelector = (selector, timeoutMs = 15000) => new Promise((resolve, reject) => {
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

            const clickIfExists = (selector) => {
              const button = document.querySelector(selector);
              if (!button) return false;
              button.click();
              return true;
            };

            const setNativeValue = (element, value) => {
              const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value')?.set;
              const prototype = Object.getPrototypeOf(element);
              const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
              if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
                prototypeValueSetter.call(element, value);
              } else if (valueSetter) {
                valueSetter.call(element, value);
              } else {
                element.value = value;
              }
            };

            const triggerInputEvents = (element) => {
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            };

            const clickButtonByText = (text) => {
              const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
              const button = buttons.find((node) => node.textContent && node.textContent.trim() === text);
              if (!button) return false;
              button.click();
              return true;
            };

            const pressEnter = (element) => {
              element.focus();
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            };

            try {
              const usernameField = await waitForSelector('input[name="text"]');
              setNativeValue(usernameField, username);
              triggerInputEvents(usernameField);
              console.log('Username filled');

              const nextSelector = 'div[role="button"][data-testid="LoginForm_Next_Button"]';
              try {
                await waitForSelector(nextSelector, 8000);
              } catch (error) {
                console.warn('Next button not found by selector, trying text match');
              }

              const clickedNext =
                clickIfExists(nextSelector) ||
                clickButtonByText('Next');

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

              const clickedLogin = clickIfExists('div[role="button"][data-testid="LoginForm_Login_Button"]');
              if (!clickedLogin) {
                console.error('Login button not found');
              }
            } catch (error) {
              console.error('Login automation failed:', error);
            }
          },
          args: [username, password]
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('executeScript failed:', chrome.runtime.lastError.message);
          } else {
            console.log('executeScript completed');
          }
        });
      }
    });
  });
}

// Example usage
const username = 'RMenila1281';
const password = '1QSR@sTOEXXaOmK!';
loginToXCom(username, password);