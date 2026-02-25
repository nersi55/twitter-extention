// Bridge between the web page and extension background
// - Listens for `window.postMessage` from the page with { extensionApi: true, id, payload }
// - Forwards payload to extension via chrome.runtime.sendMessage
// - Sends response back to page via window.postMessage({ extensionApiResponse: true, id, response })

(function () {
  // Only run in page context
  window.addEventListener('message', function (event) {
    if (!event || event.source !== window) return;
    const data = event.data;
    if (!data || data.extensionApi !== true) return;

    const id = data.id;
    const payload = data.payload || {};

    try {
      chrome.runtime.sendMessage(payload, function (response) {
        try {
          window.postMessage({ extensionApiResponse: true, id: id, response: response }, '*');
        } catch (e) {
          console.warn('content_script: failed to post response to page', e);
        }
      });
    } catch (e) {
      console.warn('content_script: sendMessage failed', e);
      try {
        window.postMessage(
          { extensionApiResponse: true, id: id, response: { error: e.message } },
          '*'
        );
      } catch (e2) {}
    }
  });

  // Forward runtime messages (from background) to the page as events so page can subscribe
  chrome.runtime.onMessage.addListener(function (message, _sender) {
    try {
      window.postMessage({ extensionApiEvent: true, message: message }, '*');
    } catch (e) {
      console.warn('content_script: failed to forward runtime message to page', e);
    }
  });

  console.log('content_script: API bridge active');
})();
