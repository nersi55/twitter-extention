document.getElementById('navigate').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'navigate', url: 'https://twitter.com' }, response => {
    console.log(response.status);
  });
});

document.getElementById('like').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'click' }, response => {
    console.log(response.status);
  });
});

// New: like 5 unliked tweets, scrolling if needed
document.getElementById('like5').addEventListener('click', () => {
  // one-time listener to receive results from the background
  const listener = message => {
    if (message && message.action === 'likeManyResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.likedUrls) || [];
          if (urls.length) {
            const msg =
              'Liked ' +
              (r.liked || urls.length) +
              ' of ' +
              (r.requested || 5) +
              ' tweets:\n\n' +
              urls.join('\n');
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

  const countInput = document.getElementById('count');
  const delayInput = document.getElementById('delaySeconds');
  const count = parseInt((countInput && countInput.value), 10) || 5;
  const delaySeconds = parseInt((delayInput && delayInput.value), 10) || 30;
  chrome.runtime.sendMessage({ action: 'likeMany', count, delaySeconds }, response => {
    console.log(response.status);
  });
});

// New: Repost 5 tweets from a given list URL
document.getElementById('repostList').addEventListener('click', () => {
  const listUrlInput = document.getElementById('listUrl');
  const countInput = document.getElementById('count');
  const listUrl =
    (listUrlInput && listUrlInput.value) || 'https://x.com/i/lists/1591905950507716608';
  const count = parseInt(countInput && countInput.value, 10) || 5;
  // one-time result listener
  const listener = message => {
    if (message && message.action === 'repostListResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.retweetedUrls) || [];
          if (urls.length) {
            const msg =
              'Reposted ' +
              (r.retweeted || urls.length) +
              ' of ' +
              (r.requested || 5) +
              ' tweets:\n\n' +
              urls.join('\n');
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
    chrome.storage.local.get('repostListLastResult', data => {
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

  const delayInput = document.getElementById('delaySeconds');
  const delaySeconds = parseInt((delayInput && delayInput.value), 10) || 30;
  chrome.runtime.sendMessage({ action: 'repostList', url: listUrl, count, delaySeconds }, response => {
    console.log(response.status);
  });
});

// New: Quote 5 tweets from the list with custom per-tweet messages
document.getElementById('quoteList').addEventListener('click', () => {
  const listUrlInput = document.getElementById('listUrl');
  const countInput = document.getElementById('count');
  const messagesInput = document.getElementById('messages');
  const listUrl =
    (listUrlInput && listUrlInput.value) || 'https://x.com/i/lists/1591905950507716608';
  const count = parseInt(countInput && countInput.value, 10) || 5;
  const rawMessages = (messagesInput && messagesInput.value) || '[Sample reply]';
  // split lines and remove empty lines
  let messages = rawMessages
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!messages.length) messages = ['[Sample reply]'];
  // If fewer messages than count, repeat last message to fill
  while (messages.length < count) messages.push(messages[messages.length - 1]);

  const listener = message => {
    if (message && message.action === 'quoteListResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.quotedUrls) || [];
          if (urls.length) {
            const msg =
              'Quoted ' +
              (r.quoted || urls.length) +
              ' of ' +
              (r.requested || 5) +
              ' tweets:\n\n' +
              urls.join('\n');
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
    chrome.storage.local.get('quoteListLastResult', data => {
      const res = data && data.quoteListLastResult;
      if (res) {
        listener({ action: 'quoteListResult', result: res });
        clearInterval(poll2);
      }
    });
    pollCount2++;
    if (pollCount2 > 12) clearInterval(poll2);
  }, 1000);

  const delayInput = document.getElementById('delaySeconds');
  const delaySeconds = parseInt((delayInput && delayInput.value), 10) || 30;
  chrome.runtime.sendMessage({ action: 'quoteList', url: listUrl, count, messages, delaySeconds }, response => {
    console.log(response.status);
  });
});

// New: Reply 5 tweets from the list with custom per-tweet messages
document.getElementById('replyList').addEventListener('click', () => {
  const listUrlInput = document.getElementById('listUrl');
  const countInput = document.getElementById('count');
  const messagesInput = document.getElementById('messages');
  const listUrl =
    (listUrlInput && listUrlInput.value) || 'https://x.com/i/lists/1591905950507716608';
  const count = parseInt(countInput && countInput.value, 10) || 5;
  const rawMessages = (messagesInput && messagesInput.value) || '[Sample reply]';
  let messages = rawMessages
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!messages.length) messages = ['[Sample reply]'];
  while (messages.length < count) messages.push(messages[messages.length - 1]);

  const listener = message => {
    if (message && message.action === 'replyListResult') {
      try {
        if (message.error) {
          alert('Error: ' + message.error);
        } else if (message.result) {
          const r = message.result;
          const urls = (r && r.repliedUrls) || [];
          if (urls.length) {
            const msg =
              'Replied to ' +
              (r.replied || urls.length) +
              ' of ' +
              (r.requested || 5) +
              ' tweets:\n\n' +
              urls.join('\n');
            alert(msg);
          } else {
            alert('No tweets were replied to.');
          }
        } else {
          alert('replyList completed but no result returned');
        }
      } finally {
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  // storage poll fallback
  let pollCount = 0;
  const poll = setInterval(() => {
    chrome.storage.local.get('replyListLastResult', data => {
      const res = data && data.replyListLastResult;
      if (res) {
        listener({ action: 'replyListResult', result: res });
        clearInterval(poll);
      }
    });
    pollCount++;
    if (pollCount > 12) clearInterval(poll);
  }, 1000);

  const delayInput = document.getElementById('delaySeconds');
  const delaySeconds = parseInt((delayInput && delayInput.value), 10) || 30;
  chrome.runtime.sendMessage({ action: 'replyList', url: listUrl, count, messages, delaySeconds }, response => {
    console.log(response.status);
  });
});
