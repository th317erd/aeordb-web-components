'use strict';

import { elements } from '../../aeor/elements.js';

const { div, button } = elements;

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
    this.textContent = '';

    const onClick = (event) => {
      event.preventDefault();
      const btn = event.currentTarget;
      if (event.shiftKey) {
        for (let i = 0; i < 8; i++) this._flags[i] = !this._flags[i];
        this.querySelectorAll('.crudlify-flag').forEach((b, i) => {
          b.classList.toggle('active', this._flags[i]);
        });
      } else {
        const idx = parseInt(btn.dataset.idx);
        this._flags[idx] = !this._flags[idx];
        btn.classList.toggle('active', this._flags[idx]);
      }
    };

    const tree = div.class('crudlify-row')(
      ...CRUDLIFY_FLAGS.map((flag, i) => {
        const cls = this._flags[i] ? 'crudlify-flag active' : 'crudlify-flag';
        return button
          .type('button')
          .class(cls)
          .dataIdx(String(i))
          .title(flag.label)
          .onClick(onClick)(flag.char.toUpperCase());
      }),
    ).build(document);

    this.appendChild(tree);
  }
}

if (!customElements.get('aeor-crudlify')) {
  customElements.define('aeor-crudlify', AeorCrudlify);
}
