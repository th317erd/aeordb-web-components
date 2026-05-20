'use strict';

import { elements } from '../../../aeor/elements.js';

const { video } = elements;

class AeorPreviewVideo extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    this.textContent = '';
    this.appendChild(video.controls('').class('preview-media')().build(document));
  }

  load() {
    let videoEl = this.querySelector('video');
    if (!videoEl) {
      this._render();
      videoEl = this.querySelector('video');
    }
    videoEl.src = this.getAttribute('src') || '';
    videoEl.load();
  }
}

customElements.define('aeor-preview-video', AeorPreviewVideo);
export { AeorPreviewVideo };
