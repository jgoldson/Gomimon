// Offscreen document for audio playback
// Required for Manifest V3 extensions to play sounds

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'playSound') {
    const sound = message.sound || 'gulp';
    const audioElement = document.getElementById(`${sound}Sound`);

    if (audioElement) {
      audioElement.currentTime = 0;
      audioElement.play()
        .then(() => {
          console.log(`Played ${sound} sound`);
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error('Error playing sound:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else {
      sendResponse({ success: false, error: 'Sound not found' });
    }

    return true; // Keep the message channel open for async response
  }
});

console.log('GomiMon offscreen audio ready');
