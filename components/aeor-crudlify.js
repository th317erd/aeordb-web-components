'use strict';

/**
 * <aeor-crudlify> — Toggle component for crudlify permission flags.
 *
 * Usage:
 *   <aeor-crudlify value="-r------"></aeor-crudlify>
 *
 * Read value:
 *   element.value  // returns string like "cr--l---"
 *
 * Set value:
 *   element.value = "crudlify"
 *
 * Shift+click inverts all flags.
 */

const CRUDLIFY_FLAGS = [
  { char: 'c', label: 'Create' },
  { char: 'r', label: 'Read' },
  { char: 'u', label: 'Update' },
  { char: 'd', label: 'Delete' },
  { char: 'l', label: 'List' },
  { char: 'i', label: 'Index' },
  { char: 'f', label: 'Fork' },
  { char: 'y', label: 'Sync' },
];

export class AeorCrudlify extends HTMLElement {
  constructor() {
    super();
    this._flags = [false, false, false, false, false, false, false, false];
  }

  connectedCallback() {
    const initial = this.getAttribute('value') || '--------';
    for (let i = 0; i < 8; i++) {
      this._flags[i] = (initial[i] && initial[i] !== '-');
    }
    this.render();
  }

  get value() {
    return this._flags.map((on, i) => on ? CRUDLIFY_FLAGS[i].char : '-').join('');
  }

  set value(v) {
    for (let i = 0; i < 8; i++) {
      this._flags[i] = (v[i] && v[i] !== '-');
    }
    this.render();
  }

  render() {
    this.innerHTML = `<div class="crudlify-row">${
      CRUDLIFY_FLAGS.map((flag, i) => {
        const active = this._flags[i] ? 'active' : '';
        return `<button type="button" class="crudlify-flag ${active}" data-idx="${i}" title="${flag.label}">${flag.char.toUpperCase()}</button>`;
      }).join('')
    }</div>`;

    this.querySelectorAll('.crudlify-flag').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          for (let i = 0; i < 8; i++) this._flags[i] = !this._flags[i];
          this.querySelectorAll('.crudlify-flag').forEach((b, i) => {
            b.classList.toggle('active', this._flags[i]);
          });
        } else {
          const idx = parseInt(btn.dataset.idx);
          this._flags[idx] = !this._flags[idx];
          btn.classList.toggle('active', this._flags[idx]);
        }
      });
    });
  }
}

if (!customElements.get('aeor-crudlify')) {
  customElements.define('aeor-crudlify', AeorCrudlify);
}
