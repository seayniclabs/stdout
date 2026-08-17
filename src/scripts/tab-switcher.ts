/**
 * Tab switching utility - client-side script
 * Loaded on pages that have tab navigation
 */

function switchTab(tabName: string) {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(t => t.classList.remove('active'));
  tabContents.forEach(c => c.classList.remove('active'));

  const targetTab = document.querySelector(`[data-tab="${tabName}"]`);
  const targetContent = document.querySelector(`[data-content="${tabName}"]`);

  if (targetTab) targetTab.classList.add('active');
  if (targetContent) targetContent.classList.add('active');
}

// Make switchTab globally available
(window as any).switchTab = switchTab;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[tab-switcher] Initialized, switchTab is available globally');
});
