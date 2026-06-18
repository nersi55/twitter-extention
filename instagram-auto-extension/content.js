// Instagram Auto Action - Content Script
// تعامل مستقیم با صفحه اینستاگرام

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'executeCommand') {
    executeCommand(request.command)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // برای پاسخ ناهمگام
  }
});

async function executeCommand(command) {
  switch (command.type) {
    case 'like':
      return await performLike(command.selector);
    case 'follow':
      return await performFollow(command.selector);
    case 'comment':
      return await performComment(command.selector, command.text);
    case 'scroll':
      return await performScroll();
    default:
      throw new Error(`Unknown command type: ${command.type}`);
  }
}

// لایک کردن پست
async function performLike(selector) {
  try {
    let likeButton;
    
    if (selector) {
      likeButton = document.querySelector(selector);
    } else {
      // پیدا کردن دکمه لایک در پست فعلی
      const article = getCurrentPost();
      if (article) {
        likeButton = article.querySelector('svg[aria-label="Like"]');
        if (!likeButton) {
          likeButton = article.querySelector('[aria-label="Unlike"]');
        }
      }
    }
    
    if (!likeButton) {
      throw new Error('Like button not found');
    }
    
    likeButton.click();
    console.log('Liked post');
    return { success: true, action: 'like' };
    
  } catch (error) {
    console.error('Error liking post:', error);
    throw error;
  }
}

// فالو کردن کاربر
async function performFollow(selector) {
  try {
    let followButton;
    
    if (selector) {
      followButton = document.querySelector(selector);
    } else {
      // پیدا کردن دکمه فالو در پروفایل یا پست
      followButton = document.querySelector('button:not([disabled]) div:contains("Follow")');
      
      if (!followButton) {
        const buttons = document.querySelectorAll('button');
        for (let btn of buttons) {
          if (btn.textContent.includes('Follow') && !btn.disabled) {
            followButton = btn;
            break;
          }
        }
      }
    }
    
    if (!followButton) {
      throw new Error('Follow button not found');
    }
    
    followButton.click();
    console.log('Followed user');
    return { success: true, action: 'follow' };
    
  } catch (error) {
    console.error('Error following user:', error);
    throw error;
  }
}

// ارسال کامنت
async function performComment(selector, text) {
  try {
    let commentBox;
    
    if (selector) {
      commentBox = document.querySelector(selector);
    } else {
      // پیدا کردن جعبه کامنت
      commentBox = document.querySelector('textarea[placeholder="Add a comment..."]');
      
      if (!commentBox) {
        commentBox = document.querySelector('textarea[aria-label="Add a comment…"]');
      }
    }
    
    if (!commentBox) {
      throw new Error('Comment box not found');
    }
    
    // کلیک روی جعبه کامنت
    commentBox.click();
    await sleep(500);
    
    // تایپ متن کامنت
    commentBox.value = text;
    commentBox.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    
    // پیدا کردن و کلیک دکمه ارسال
    const postButton = document.querySelector('button[type="submit"]');
    if (postButton) {
      postButton.click();
      console.log('Comment posted');
    } else {
      throw new Error('Post button not found');
    }
    
    return { success: true, action: 'comment' };
    
  } catch (error) {
    console.error('Error posting comment:', error);
    throw error;
  }
}

// اسکرول صفحه
async function performScroll() {
  window.scrollBy(0, 800);
  console.log('Scrolled page');
  return { success: true, action: 'scroll' };
}

// دریافت پست فعلی
function getCurrentPost() {
  const articles = document.querySelectorAll('article');
  if (articles.length === 0) return null;
  
  // پیدا کردن اولین پستی که در viewport است
  for (let article of articles) {
    const rect = article.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
      return article;
    }
  }
  
  return articles[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function برای پیدا کردن المنت بر اساس متن
if (!String.prototype.contains) {
  String.prototype.contains = function(str) {
    return this.indexOf(str) !== -1;
  };
}
