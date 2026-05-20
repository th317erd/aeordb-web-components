'use strict';

import { elements } from '../../../aeor/elements.js';

const { audio } = elements;

class AeorPreviewAudio extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    this.textContent = '';
    this.appendChild(audio.controls('').class('preview-media')().build(document));
  }

  load() {
    let audioEl = this.querySelector('audio');
    if (!audioEl) {
      this._render();
      audioEl = this.querySelector('audio');
    }
    audioEl.src = this.getAttribute('src') || '';
    audioEl.load();
  }
}

customElements.define('aeor-preview-audio', AeorPreviewAudio);
export { AeorPreviewAudio };
