'use strict';

/**
 * <aeor-tab-view> — Reusable tab view component (no Shadow DOM).
 *
 * Supports both static (declarative HTML) and dynamic (JS API) tabs.
 *
 * Static usage:
 *   <aeor-tab-view active="general">
 *     <aeor-tab label="General" name="general">...content...</aeor-tab>
 *     <aeor-tab label="Plugins" name="plugins">...content...</aeor-tab>
 *   </aeor-tab-view>
 *
 * Dynamic usage:
 *   <aeor-tab-view closable new-tab></aeor-tab-view>
 *
 * Attributes:
 *   active   — initial active tab name
 *   closable — show close button on tabs
 *   new-tab  — show + button for new tabs
 *
 * Events:
 *   tab-change — { detail: { tab: name } }
 *   tab-close  — { detail: { tab: name } }
 *   tab-new    — fired when + is clicked
 */

class AeorTabView extends HTMLElement {
  constructor() {
    super();
    this._activeTab = null;
    this._dynamicTabs = []; // { name, label }
    this._tabBar = null;
  }

  connectedCallback() {
    this._activeTab = this.getAttribute('active') || null;
    this._buildFromChildren();
  }

  // ---------------------------------------------------------------------------
  // Static tab detection (from <aeor-tab> children)
  // ---------------------------------------------------------------------------

  _buildFromChildren() {
    const tabs = Array.from(this.querySelectorAll(':scope > aeor-tab'));
    if (tabs.length > 0) {
      // Default to first tab
      if (!this._activeTab) {
        this._activeTab = tabs[0].getAttribute('name');
      }
      // Show/hide tab content via class
      for (const tab of tabs) {
        const name = tab.getAttribute('name');
        if (name === this._activeTab) {
          tab.classList.remove('hidden');
        } else {
          tab.classList.add('hidden');
        }
      }
    }
    this._renderTabBar();
  }

  // ---------------------------------------------------------------------------
  // Tab bar rendering (rebuilds the entire bar)
  // ---------------------------------------------------------------------------

  _renderTabBar() {
    // Remove existing bar
    if (this._tabBar) {
      this._tabBar.remove();
    }

    const tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    this._tabBar = tabBar;

    // Collect tabs: static children + dynamic
    const staticTabs = Array.from(this.querySelectorAll(':scope > aeor-tab'));
    const closable = this.hasAttribute('closable');

    // Static tabs
    for (const tab of staticTabs) {
      const name = tab.getAttribute('name');
      const label = tab.getAttribute('label') || name;
      tabBar.appendChild(this._createTabButton(name, label, closable));
    }

    // Dynamic tabs
    for (const dt of this._dynamicTabs) {
      tabBar.appendChild(this._createTabButton(dt.name, dt.label, closable));
    }

    // New-tab button
    if (this.hasAttribute('new-tab')) {
      const newBtn = document.createElement('div');
      newBtn.className = 'tab-new';
      newBtn.title = 'Open new tab';
      newBtn.textContent = '+';
      newBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('tab-new', { bubbles: true }));
      });
      tabBar.appendChild(newBtn);
    }

    // Insert bar at the top
    this.insertBefore(tabBar, this.firstChild);

    // Delegated click for tab labels
    tabBar.addEventListener('click', (event) => {
      const closeBtn = event.target.closest('.tab-close');
      if (closeBtn) {
        event.stopPropagation();
        const tabEl = closeBtn.closest('.tab');
        if (tabEl) {
          this.dispatchEvent(new CustomEvent('tab-close', {
            detail: { tab: tabEl.dataset.tab },
            bubbles: true,
          }));
        }
        return;
      }

      const tabEl = event.target.closest('.tab');
      if (tabEl && tabEl.dataset.tab) {
        this.switchTo(tabEl.dataset.tab);
      }
    });
  }

  _createTabButton(name, label, closable) {
    const div = document.createElement('div');
    div.className = 'tab' + (name === this._activeTab ? ' active' : '');
    div.dataset.tab = name;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab-label';
    labelSpan.textContent = label;
    div.appendChild(labelSpan);

    if (closable) {
      const closeSpan = document.createElement('span');
      closeSpan.className = 'tab-close';
      closeSpan.innerHTML = '&times;';
      div.appendChild(closeSpan);
    }

    return div;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get activeTab() {
    return this._activeTab;
  }

  set activeTab(name) {
    this.switchTo(name);
  }

  switchTo(name) {
    if (this._activeTab === name) return;
    this._activeTab = name;

    // Update tab buttons
    if (this._tabBar) {
      for (const btn of this._tabBar.querySelectorAll('.tab')) {
        btn.classList.toggle('active', btn.dataset.tab === name);
      }
    }

    // Show/hide static tab content
    for (const tab of this.querySelectorAll(':scope > aeor-tab')) {
      if (tab.getAttribute('name') === name) {
        tab.classList.remove('hidden');
      } else {
        tab.classList.add('hidden');
      }
    }

    // Show/hide dynamic tab content containers
    for (const container of this.querySelectorAll(':scope > .tab-view-content')) {
      if (container.dataset.tab === name) {
        container.classList.remove('hidden');
      } else {
        container.classList.add('hidden');
      }
    }

    this.dispatchEvent(new CustomEvent('tab-change', {
      detail: { tab: name },
      bubbles: true,
    }));
  }

  /**
   * Add a dynamic tab. Returns the content container element.
   */
  addTab(name, label) {
    this._dynamicTabs.push({ name, label });

    // Create content container
    const container = document.createElement('div');
    container.className = 'tab-view-content hidden';
    container.dataset.tab = name;
    this.appendChild(container);

    // Rebuild tab bar
    this._renderTabBar();

    return container;
  }

  /**
   * Remove a dynamic tab by name.
   */
  removeTab(name) {
    this._dynamicTabs = this._dynamicTabs.filter((t) => t.name !== name);

    // Remove content container
    const container = this.querySelector(`:scope > .tab-view-content[data-tab="${name}"]`);
    if (container) container.remove();

    // If we removed the active tab, switch to the last remaining
    if (this._activeTab === name) {
      const remaining = this._dynamicTabs;
      if (remaining.length > 0) {
        this._activeTab = remaining[remaining.length - 1].name;
      } else {
        const staticTabs = Array.from(this.querySelectorAll(':scope > aeor-tab'));
        this._activeTab = staticTabs.length > 0 ? staticTabs[0].getAttribute('name') : null;
      }
    }

    // Rebuild tab bar
    this._renderTabBar();

    // Ensure new active tab is visible
    if (this._activeTab) {
      this.switchTo(this._activeTab);
    }
  }

  /**
   * Update a tab's label text.
   */
  updateLabel(name, label) {
    // Update dynamic tabs array
    const dt = this._dynamicTabs.find((t) => t.name === name);
    if (dt) dt.label = label;

    // Update static tab attribute
    const staticTab = this.querySelector(`:scope > aeor-tab[name="${name}"]`);
    if (staticTab) staticTab.setAttribute('label', label);

    // Update the DOM button label directly (no full rebuild)
    if (this._tabBar) {
      const btn = this._tabBar.querySelector(`.tab[data-tab="${name}"] .tab-label`);
      if (btn) btn.textContent = label;
    }
  }
}

class AeorTab extends HTMLElement {
  // Content container — no special behavior needed
}

customElements.define('aeor-tab-view', AeorTabView);
customElements.define('aeor-tab', AeorTab);
