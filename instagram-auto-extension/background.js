// Instagram Auto Action - Background Script
// مدیریت صف دستورات و اجرای خودکار عملیات

let commandQueue = [];
let isProcessing = false;
let currentConfig = {};

// بارگذاری تنظیمات از storage
chrome.storage.local.get(['config'], (result) => {
  if (result.config) {
    currentConfig = result.config;
  }
});

// گوش دادن به تغییرات config
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.config) {
    currentConfig = changes.config.newValue;
  }
});

// دریافت پیام از popup یا content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addCommand') {
    commandQueue.push(request.command);
    processQueue();
    sendResponse({ status: 'added', queueLength: commandQueue.length });
  } else if (request.action === 'getQueue') {
    sendResponse({ queue: commandQueue, isProcessing });
  } else if (request.action === 'clearQueue') {
    commandQueue = [];
    isProcessing = false;
    sendResponse({ status: 'cleared' });
  } else if (request.action === 'pause') {
    isProcessing = false;
    sendResponse({ status: 'paused' });
  } else if (request.action === 'resume') {
    isProcessing = true;
    processQueue();
    sendResponse({ status: 'resumed' });
  }
  return true;
});

async function processQueue() {
  if (isProcessing || commandQueue.length === 0) return;
  
  isProcessing = true;
  
  while (commandQueue.length > 0 && isProcessing) {
    const command = commandQueue.shift();
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, url: 'https://www.instagram.com/*' });
      
      if (!tab) {
        console.log('No Instagram tab found');
        commandQueue.unshift(command);
        await sleep(5000);
        continue;
      }
      
      // ارسال دستور به content script
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'executeCommand', 
        command 
      });
      
      if (response && response.success) {
        console.log(`Command executed: ${command.type}`);
      } else {
        console.log('Command failed, re-queueing');
        commandQueue.unshift(command);
      }
      
      // تاخیر بین عملیات برای جلوگیری از بلاک شدن
      const delay = currentConfig.delayBetweenActions || 3000;
      await sleep(delay);
      
    } catch (error) {
      console.error('Error processing command:', error);
      commandQueue.unshift(command);
      await sleep(5000);
    }
  }
  
  isProcessing = false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// شروع پردازش هنگام راه‌اندازی
processQueue();
