'use strict';

/**
 * <aeor-tab-view> — Reusable tab view component (no Shadow DOM).
 *
 * Usage:
 *   <aeor-tab-view>
 *     <aeor-tab label="General" name="general">
 *       ...content...
 *     </aeor-tab>
 *     <aeor-tab label="Plugins" name="plugins">
 *       ...content...
 *     </aeor-tab>
 *   </aeor-tab-view>
 *
 * The first tab is active by default, or set active="tab-name".
 */

class AeorTabView extends HTMLElement {
  connectedCallback() {
    this._activeTab = this.getAttribute('active') || null;
    this._buildTabs();
  }

  _buildTabs() {
    const tabs = Array.from(this.querySelectorAll(':scope > aeor-tab'));
    if (tabs.length === 0)
      return;

    // Default to first tab
    if (!this._activeTab)
      this._activeTab = tabs[0].getAttribute('name');

    // Create the tab bar
    let tabBar = this.querySelector('.aeor-tab-bar');
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.className = 'aeor-tab-bar';
      this.insertBefore(tabBar, this.firstChild);
    }

    tabBar.innerHTML = tabs.map((tab) => {
      const name   = tab.getAttribute('name');
      const label  = tab.getAttribute('label') || name;
      const active = (name === this._activeTab) ? ' active' : '';
      return `<div class="aeor-tab-button${active}" data-tab="${name}">${label}</div>`;
    }).join('');

    // Show/hide tab content
    for (const tab of tabs) {
      const name = tab.getAttribute('name');
      tab.style.display = (name === this._activeTab) ? '' : 'none';
    }

    // Click handler
    tabBar.addEventListener('click', (event) => {
      const button = event.target.closest('.aeor-tab-button');
      if (!button)
        return;

      const name = button.dataset.tab;
      this.switchTo(name);
    });
  }

  switchTo(name) {
    this._activeTab = name;

    // Update buttons
    for (const button of this.querySelectorAll('.aeor-tab-button')) {
      button.classList.toggle('active', button.dataset.tab === name);
    }

    // Show/hide content
    for (const tab of this.querySelectorAll(':scope > aeor-tab')) {
      tab.style.display = (tab.getAttribute('name') === name) ? '' : 'none';
    }

    this.dispatchEvent(new CustomEvent('tab-change', {
      detail: { tab: name },
      bubbles: true,
    }));
  }

  get activeTab() {
    return this._activeTab;
  }
}

class AeorTab extends HTMLElement {
  // Content container — no special behavior needed
}

customElements.define('aeor-tab-view', AeorTabView);
customElements.define('aeor-tab', AeorTab);
