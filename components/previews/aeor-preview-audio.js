'use strict';

import { elements } from '../../../aeor/elements.js';

const { audio } = elements;

class AeorPreviewAudio extends HTMLElement {
  connectedCallback() {
    if (!this.querySelector('audio')) {
      this._render();
    }
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
    const nextSrc = this.getAttribute('src') || '';
    if (this._loadedSrc === nextSrc && audioEl.getAttribute('src') === nextSrc) {
      return;
    }
    this._loadedSrc = nextSrc;
    audioEl.src = nextSrc;
    audioEl.load();
  }
}

customElements.define('aeor-preview-audio', AeorPreviewAudio);
export { AeorPreviewAudio };
