document.getElementById("navigate").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "navigate", url: "https://twitter.com" }, (response) => {
    console.log(response.status);
  });
});

document.getElementById("like").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "click" }, (response) => {
    console.log(response.status);
  });
});

// New: like 5 unliked tweets, scrolling if needed
document.getElementById("like5").addEventListener("click", () => {
  // one-time listener to receive results from the background
  const listener = (message, sender) => {
    if (message && message.action === 'likeManyResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.likedUrls) || [];
          if (urls.length) {
            const msg = 'Liked ' + (r.liked || urls.length) + ' of ' + (r.requested || 5) + ' tweets:\n\n' + urls.join('\n');
            alert(msg);
          } else {
            alert('No tweets were liked.');
          }
        } else {
          alert('likeMany completed but no result returned');
        }
      } finally {
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  chrome.runtime.sendMessage({ action: "likeMany", count: 5 }, (response) => {
    console.log(response.status);
  });
});