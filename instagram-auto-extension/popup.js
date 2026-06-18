// Instagram Auto Action - Popup Script
// مدیریت رابط کاربری و ارتباط با background script

let isPaused = false;

document.addEventListener('DOMContentLoaded', () => {
  const actionType = document.getElementById('actionType');
  const commentSection = document.getElementById('commentSection');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusValue = document.getElementById('statusValue');
  const queueLengthEl = document.getElementById('queueLength');
  const queueList = document.getElementById('queueList');
  const delayInput = document.getElementById('delayBetweenActions');
  const autoScrollSelect = document.getElementById('autoScroll');

  // نمایش بخش کامنت وقتی نوع عملیات کامنت است
  actionType.addEventListener('change', () => {
    if (actionType.value === 'comment') {
      commentSection.style.display = 'block';
    } else {
      commentSection.style.display = 'none';
    }
  });

  // ذخیره تنظیمات
  function saveConfig() {
    const config = {
      delayBetweenActions: parseInt(delayInput.value) || 3000,
      autoScroll: autoScrollSelect.value === 'true'
    };
    
    chrome.storage.local.set({ config }, () => {
      console.log('Config saved:', config);
    });
  }

  delayInput.addEventListener('change', saveConfig);
  autoScrollSelect.addEventListener('change', saveConfig);

  // بارگذاری تنظیمات ذخیره شده
  chrome.storage.local.get(['config'], (result) => {
    if (result.config) {
      delayInput.value = result.config.delayBetweenActions || 3000;
      autoScrollSelect.value = result.config.autoScroll ? 'true' : 'false';
    }
  });

  // شروع عملیات
  startBtn.addEventListener('click', async () => {
    const type = actionType.value;
    const commentText = document.getElementById('commentText').value;
    
    let command = { type };
    
    if (type === 'comment') {
      if (!commentText.trim()) {
        alert('لطفا متن کامنت را وارد کنید');
        return;
      }
      command.text = commentText;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'addCommand', 
        command 
      });
      
      updateStatus(response.queueLength);
      
      if (type === 'scroll' && autoScrollSelect.value === 'true') {
        // اگر اسکرول خودکار فعال است، چندین دستور اسکرول اضافه کن
        for (let i = 0; i < 5; i++) {
          await chrome.runtime.sendMessage({ 
            action: 'addCommand', 
            command: { type: 'scroll' }
          });
        }
        updateStatus(response.queueLength + 5);
      }
      
    } catch (error) {
      console.error('Error adding command:', error);
      alert('خطا در افزودن دستور');
    }
  });

  // توقف موقت
  pauseBtn.addEventListener('click', async () => {
    try {
      if (isPaused) {
        await chrome.runtime.sendMessage({ action: 'resume' });
        pauseBtn.textContent = '⏸️ توقف موقت';
        pauseBtn.classList.remove('paused');
        statusValue.textContent = 'در حال اجرا';
        isPaused = false;
      } else {
        await chrome.runtime.sendMessage({ action: 'pause' });
        pauseBtn.textContent = '▶️ ادامه';
        pauseBtn.classList.add('paused');
        statusValue.textContent = 'متوقف شده';
        isPaused = true;
      }
    } catch (error) {
      console.error('Error toggling pause:', error);
    }
  });

  // پاک کردن صف
  clearBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'clearQueue' });
      updateStatus(0);
      queueList.innerHTML = '';
      statusValue.textContent = 'در انتظار';
    } catch (error) {
      console.error('Error clearing queue:', error);
    }
  });

  // بروزرسانی وضعیت
  async function updateStatus(queueLen) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getQueue' });
      
      queueLengthEl.textContent = response.queue.length;
      statusValue.textContent = response.isProcessing ? 'در حال اجرا' : 'در انتظار';
      
      // نمایش لیست صف
      queueList.innerHTML = '';
      response.queue.slice(0, 10).forEach((cmd, index) => {
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.textContent = `${index + 1}. ${translateAction(cmd.type)}${cmd.text ? ': ' + cmd.text : ''}`;
        queueList.appendChild(item);
      });
      
      if (response.queue.length > 10) {
        const more = document.createElement('div');
        more.style.textAlign = 'center';
        more.style.color = '#999';
        more.style.fontSize = '12px';
        more.textContent = `... و ${response.queue.length - 10} مورد دیگر`;
        queueList.appendChild(more);
      }
      
    } catch (error) {
      console.error('Error getting status:', error);
    }
  }

  function translateAction(type) {
    const translations = {
      'like': '❤️ لایک',
      'follow': '➕ فالو',
      'comment': '💬 کامنت',
      'scroll': '📜 اسکرول'
    };
    return translations[type] || type;
  }

  // بروزرسانی خودکار وضعیت هر 2 ثانیه
  setInterval(updateStatus, 2000);
  updateStatus();
});
