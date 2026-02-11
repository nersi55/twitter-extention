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

// New: Repost 5 tweets from a given list URL
document.getElementById('repostList').addEventListener('click', () => {
  const listUrl = 'https://x.com/i/lists/1591905950507716608'; // default list URL (user-specified)
  // one-time result listener
  const listener = (message) => {
    if (message && message.action === 'repostListResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.retweetedUrls) || [];
          if (urls.length) {
            const msg = 'Reposted ' + (r.retweeted || urls.length) + ' of ' + (r.requested || 5) + ' tweets:\n\n' + urls.join('\n');
            alert(msg);
          } else {
            alert('No tweets were reposted.');
          }
        } else {
          alert('repostList completed but no result returned');
        }
      } finally {
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  // Poll storage as a fallback (in case popup is open but message arrives before listener attached or message delivery fails)
  let pollCount = 0;
  const poll = setInterval(() => {
    chrome.storage.local.get('repostListLastResult', (data) => {
      const res = data && data.repostListLastResult;
      if (res) {
        // simulate the runtime message so the same handler handles it
        listener({ action: 'repostListResult', result: res });
        clearInterval(poll);
      }
    });
    pollCount++;
    if (pollCount > 12) clearInterval(poll); // stop after ~12s
  }, 1000);

  chrome.runtime.sendMessage({ action: 'repostList', url: listUrl, count: 5 }, (response) => {
    console.log(response.status);
  });
});

// New: Quote 5 tweets from the list with custom per-tweet messages
document.getElementById('quoteList').addEventListener('click', () => {
  const listUrl = 'https://x.com/i/lists/1591905950507716608';
  const messages = [
    '[جاوید شاه]',
    '[#سعید_سیفی]',
    '[«نمی‌بخشیم و فراموش نمی‌کنیم»]',
    '[بی زارم از دین شما]',
    '[#IranMassacre]'
  ];

  const listener = (message) => {
    if (message && message.action === 'quoteListResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.quotedUrls) || [];
          if (urls.length) {
            const msg = 'Quoted ' + (r.quoted || urls.length) + ' of ' + (r.requested || 5) + ' tweets:\n\n' + urls.join('\n');
            alert(msg);
          } else {
            alert('No tweets were quoted.');
          }
        } else {
          alert('quoteList completed but no result returned');
        }
      } finally {
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  // storage poll fallback
  let pollCount2 = 0;
  const poll2 = setInterval(() => {
    chrome.storage.local.get('quoteListLastResult', (data) => {
      const res = data && data.quoteListLastResult;
      if (res) {
        listener({ action: 'quoteListResult', result: res });
        clearInterval(poll2);
      }
    });
    pollCount2++;
    if (pollCount2 > 12) clearInterval(poll2);
  }, 1000);

  chrome.runtime.sendMessage({ action: 'quoteList', url: listUrl, count: 5, messages }, (response) => {
    console.log(response.status);
  });
});