'use strict';

import { elements } from '../../../aeor/elements.js';

const { button, div, input, line, path, polyline, span, svg, video } = elements;

function _playIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('currentColor')
    .ariaHidden('true')(
      path.d('M8 5v14l11-7z')(),
    );
}

function _pauseIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('currentColor')
    .ariaHidden('true')(
      path.d('M6 5h4v14H6z')(),
      path.d('M14 5h4v14h-4z')(),
    );
}

function _volumeIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('none')
    .stroke('currentColor')
    .strokeWidth('2')
    .strokeLinecap('round')
    .strokeLinejoin('round')
    .ariaHidden('true')(
      path.d('M11 5L6 9H2v6h4l5 4V5z')(),
      path.d('M15.54 8.46a5 5 0 010 7.07')(),
      path.d('M19.07 4.93a10 10 0 010 14.14')(),
    );
}

function _mutedIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('none')
    .stroke('currentColor')
    .strokeWidth('2')
    .strokeLinecap('round')
    .strokeLinejoin('round')
    .ariaHidden('true')(
      path.d('M11 5L6 9H2v6h4l5 4V5z')(),
      line.x1('23').y1('9').x2('17').y2('15')(),
      line.x1('17').y1('9').x2('23').y2('15')(),
    );
}

function _fullscreenIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('none')
    .stroke('currentColor')
    .strokeWidth('2')
    .strokeLinecap('round')
    .strokeLinejoin('round')
    .ariaHidden('true')(
      polyline.points('15 3 21 3 21 9')(),
      polyline.points('9 21 3 21 3 15')(),
      line.x1('21').y1('3').x2('14').y2('10')(),
      line.x1('3').y1('21').x2('10').y2('14')(),
    );
}

function _exitFullscreenIcon() {
  return svg
    .width('18').height('18').viewBox('0 0 24 24')
    .fill('none')
    .stroke('currentColor')
    .strokeWidth('2')
    .strokeLinecap('round')
    .strokeLinejoin('round')
    .ariaHidden('true')(
      polyline.points('4 14 10 14 10 20')(),
      polyline.points('20 10 14 10 14 4')(),
      line.x1('14').y1('10').x2('21').y2('3')(),
      line.x1('3').y1('21').x2('10').y2('14')(),
    );
}

class AeorPreviewVideo extends HTMLElement {
  constructor() {
    super();
    this._toggleFullscreen = this._toggleFullscreen.bind(this);
    this._syncFullscreenState = this._syncFullscreenState.bind(this);
    this._syncMediaControls = this._syncMediaControls.bind(this);
    this._isSeeking = false;
    this._pendingSeekTime = null;
    this._controlsHideTimer = null;
    this._controlsHovered = false;
    this._controlsFocused = false;
    this._keyboardFocusMode = false;
    this._onDocumentKeydown = this._onDocumentKeydown.bind(this);
    this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
  }

  connectedCallback() {
    if (!this.querySelector('video')) {
      this._render();
    }
    document.addEventListener('fullscreenchange', this._syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', this._syncFullscreenState);
    document.addEventListener('keydown', this._onDocumentKeydown, true);
    document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
    this._syncFullscreenState();
    this._showControls();
    this._scheduleControlsHide();
  }

  disconnectedCallback() {
    document.removeEventListener('fullscreenchange', this._syncFullscreenState);
    document.removeEventListener('webkitfullscreenchange', this._syncFullscreenState);
    document.removeEventListener('keydown', this._onDocumentKeydown, true);
    document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
    this._clearControlsHideTimer();
    this._stopPlayback();
  }

  _render() {
    this.textContent = '';
    const videoEl = video.class('preview-media preview-video-element')().build(document);
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';

    const playButton = button
      .type('button')
      .class('preview-video-control preview-video-play')
      .title('Play')
      .ariaLabel('Play')(
        _playIcon(),
      )
      .build(document);

    const timeEl = span.class('preview-video-time')('0:00 / 0:00').build(document);

    const seekInput = input
      .type('range')
      .class('preview-video-seek')
      .min('0')
      .max('1000')
      .step('1')
      .value('0')
      .ariaLabel('Seek')()
      .build(document);

    const muteButton = button
      .type('button')
      .class('preview-video-control preview-video-mute')
      .title('Mute')
      .ariaLabel('Mute')(
        _volumeIcon(),
      )
      .build(document);

    const volumeInput = input
      .type('range')
      .class('preview-video-volume')
      .min('0')
      .max('1')
      .step('0.01')
      .value('1')
      .ariaLabel('Volume')()
      .build(document);

    const fullscreenButton = button
      .type('button')
      .class('preview-video-control preview-video-fullscreen')
      .title('Fullscreen')
      .ariaLabel('Fullscreen')(
        _fullscreenIcon(),
      )
      .build(document);

    const controlRow = div.class('preview-video-control-row')().build(document);
    controlRow.appendChild(playButton);
    controlRow.appendChild(timeEl);
    controlRow.appendChild(seekInput);
    controlRow.appendChild(muteButton);
    controlRow.appendChild(volumeInput);
    controlRow.appendChild(fullscreenButton);

    const controls = div.class('preview-video-controls')().build(document);
    controls.appendChild(controlRow);

    const frame = div.class('preview-video-frame')().build(document);
    frame.appendChild(videoEl);
    frame.appendChild(controls);
    this.appendChild(frame);

    frame.addEventListener('pointermove', () => {
      this._showControls();
      this._scheduleControlsHide();
    });
    frame.addEventListener('pointerleave', () => this._scheduleControlsHide(650));
    controls.addEventListener('pointerenter', () => {
      this._controlsHovered = true;
      this._showControls();
      this._clearControlsHideTimer();
    });
    controls.addEventListener('pointerleave', () => {
      this._controlsHovered = false;
      this._scheduleControlsHide();
    });
    controls.addEventListener('focusin', () => {
      this._controlsFocused = this._keyboardFocusMode;
      this._showControls();
      if (this._controlsFocused) this._clearControlsHideTimer();
      else this._scheduleControlsHide();
    });
    controls.addEventListener('focusout', () => {
      queueMicrotask(() => {
        this._controlsFocused = controls.contains(document.activeElement);
        this._scheduleControlsHide();
      });
    });
    videoEl.addEventListener('click', () => this._togglePlay());
    videoEl.addEventListener('play', this._syncMediaControls);
    videoEl.addEventListener('pause', this._syncMediaControls);
    videoEl.addEventListener('timeupdate', this._syncMediaControls);
    videoEl.addEventListener('durationchange', this._syncMediaControls);
    videoEl.addEventListener('loadedmetadata', this._syncMediaControls);
    videoEl.addEventListener('volumechange', this._syncMediaControls);
    playButton.addEventListener('click', () => this._togglePlay());
    muteButton.addEventListener('click', () => this._toggleMute());
    volumeInput.addEventListener('input', () => this._setVolume());
    seekInput.addEventListener('pointerdown', () => {
      this._isSeeking = true;
      this._showControls();
      this._clearControlsHideTimer();
    });
    seekInput.addEventListener('pointerup', () => {
      this._seek();
      this._isSeeking = false;
      this._syncMediaControls();
      this._scheduleControlsHide();
    });
    seekInput.addEventListener('pointercancel', () => {
      this._isSeeking = false;
      this._pendingSeekTime = null;
      this._syncMediaControls();
      this._scheduleControlsHide();
    });
    seekInput.addEventListener('input', () => this._seek({ preview: true }));
    seekInput.addEventListener('change', () => {
      this._seek();
      this._isSeeking = false;
      this._syncMediaControls();
      this._scheduleControlsHide();
    });
    fullscreenButton.addEventListener('click', this._toggleFullscreen);
    this._syncMediaControls();
    this._showControls();
    this._scheduleControlsHide();
  }

  _onDocumentKeydown(event) {
    if (event.key === 'Tab') {
      this._keyboardFocusMode = true;
    }
  }

  _onDocumentPointerDown() {
    this._keyboardFocusMode = false;
    this._controlsFocused = false;
  }

  load() {
    let videoEl = this.querySelector('video');
    if (!videoEl) {
      this._render();
      videoEl = this.querySelector('video');
    }
    const nextSrc = this.getAttribute('src') || '';
    if (this._loadedSrc === nextSrc && videoEl.getAttribute('src') === nextSrc) {
      return;
    }
    this._stopPlayback();
    this._loadedSrc = nextSrc;
    if (nextSrc) {
      videoEl.src = nextSrc;
      videoEl.load();
    }
    this._syncMediaControls();
  }

  async _togglePlay() {
    const videoEl = this.querySelector('video');
    if (!videoEl) return;
    this._showControls();
    if (videoEl.paused) {
      try {
        await videoEl.play();
      } catch (_error) {
        // Browser policy or decoder errors surface through the media element.
      }
    } else {
      videoEl.pause();
    }
    this._syncMediaControls();
    this._scheduleControlsHide();
  }

  _toggleMute() {
    const videoEl = this.querySelector('video');
    if (!videoEl) return;
    this._showControls();
    videoEl.muted = !videoEl.muted;
    this._syncMediaControls();
    this._scheduleControlsHide();
  }

  _setVolume() {
    const videoEl = this.querySelector('video');
    const volumeInput = this.querySelector('.preview-video-volume');
    if (!videoEl || !volumeInput) return;
    this._showControls();
    videoEl.volume = Number(volumeInput.value);
    videoEl.muted = videoEl.volume === 0;
    this._syncMediaControls();
    this._scheduleControlsHide();
  }

  _seek({ preview = false } = {}) {
    const videoEl = this.querySelector('video');
    const seekInput = this.querySelector('.preview-video-seek');
    if (!videoEl || !seekInput || !Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
    const value = Number(seekInput.value);
    if (!Number.isFinite(value)) return;

    const ratio = Math.max(0, Math.min(1000, value)) / 1000;
    const targetTime = Math.max(0, Math.min(videoEl.duration, ratio * videoEl.duration));
    this._pendingSeekTime = targetTime;

    if (!preview || !this._isSeeking) {
      videoEl.currentTime = targetTime;
      this._pendingSeekTime = null;
    }
    this._syncMediaControls();
  }

  _syncMediaControls() {
    const videoEl = this.querySelector('video');
    const playButton = this.querySelector('.preview-video-play');
    const muteButton = this.querySelector('.preview-video-mute');
    const seekInput = this.querySelector('.preview-video-seek');
    const volumeInput = this.querySelector('.preview-video-volume');
    const timeEl = this.querySelector('.preview-video-time');
    if (!videoEl || !playButton || !muteButton || !seekInput || !volumeInput || !timeEl) return;

    this._setButtonIcon(playButton, videoEl.paused ? _playIcon() : _pauseIcon(), videoEl.paused ? 'Play' : 'Pause');
    const muted = videoEl.muted || videoEl.volume === 0;
    this._setButtonIcon(muteButton, muted ? _mutedIcon() : _volumeIcon(), muted ? 'Unmute' : 'Mute');

    if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      const displayTime =
        (this._isSeeking && Number.isFinite(this._pendingSeekTime))
          ? this._pendingSeekTime
          : videoEl.currentTime;
      seekInput.disabled = false;
      if (!this._isSeeking) {
        seekInput.value = String(Math.round((videoEl.currentTime / videoEl.duration) * 1000));
      }
      const seekPercent = Math.max(0, Math.min(100, (Number(seekInput.value) / 1000) * 100));
      seekInput.style.setProperty('--aeor-range-progress', `${seekPercent}%`);
      timeEl.textContent = `${this._formatTime(displayTime)} / ${this._formatTime(videoEl.duration)}`;
    } else {
      seekInput.disabled = true;
      seekInput.value = '0';
      seekInput.style.setProperty('--aeor-range-progress', '0%');
      timeEl.textContent = '0:00 / 0:00';
    }

    volumeInput.value = muted ? '0' : String(videoEl.volume);
    volumeInput.style.setProperty(
      '--aeor-range-progress',
      `${Math.max(0, Math.min(100, Number(volumeInput.value) * 100))}%`,
    );
  }

  async _toggleFullscreen(event) {
    event.preventDefault();
    event.stopPropagation();

    const frame = this.querySelector('.preview-video-frame');
    if (!frame) return;

    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreenElement === frame) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }

    if (frame.requestFullscreen) await frame.requestFullscreen();
    else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
  }

  _syncFullscreenState() {
    const frame = this.querySelector('.preview-video-frame');
    const fullscreenButton = this.querySelector('.preview-video-fullscreen');
    if (!frame || !fullscreenButton) return;

    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    const active = fullscreenElement === frame;
    frame.classList.toggle('fullscreen-active', active);
    this._setButtonIcon(
      fullscreenButton,
      active ? _exitFullscreenIcon() : _fullscreenIcon(),
      active ? 'Exit fullscreen' : 'Fullscreen',
    );
  }

  _setButtonIcon(buttonEl, icon, label) {
    buttonEl.title = label;
    buttonEl.setAttribute('aria-label', label);
    buttonEl.textContent = '';
    buttonEl.appendChild(icon.build(document));
  }

  _showControls() {
    const frame = this.querySelector('.preview-video-frame');
    if (!frame) return;
    frame.classList.remove('controls-hidden');
  }

  _hideControls() {
    if (this._controlsHovered || this._controlsFocused || this._isSeeking) return;
    const frame = this.querySelector('.preview-video-frame');
    if (!frame) return;
    frame.classList.add('controls-hidden');
  }

  _scheduleControlsHide(delay = 1800) {
    this._clearControlsHideTimer();
    if (this._controlsHovered || this._controlsFocused || this._isSeeking) return;
    this._controlsHideTimer = setTimeout(() => {
      this._controlsHideTimer = null;
      this._hideControls();
    }, delay);
  }

  _clearControlsHideTimer() {
    if (this._controlsHideTimer) {
      clearTimeout(this._controlsHideTimer);
      this._controlsHideTimer = null;
    }
  }

  _stopPlayback() {
    const videoEl = this.querySelector('video');
    if (!videoEl) return;
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    this._loadedSrc = '';
    this._isSeeking = false;
    this._pendingSeekTime = null;
    this._controlsHovered = false;
    this._controlsFocused = false;
    this._clearControlsHideTimer();
  }

  _formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
}

customElements.define('aeor-preview-video', AeorPreviewVideo);
export { AeorPreviewVideo };
