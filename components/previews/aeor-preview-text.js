'use strict';

import { elements } from '../../../aeor/elements.js';
import { escapeHtml } from '../../utils.js';

const { div, pre, code } = elements;

class AeorPreviewText extends HTMLElement {
  constructor() {
    super();
    this._currentSrc = null;
  }

  connectedCallback() {
    this._showLoading();
  }

  _showLoading() {
    this.textContent = '';
    this.appendChild(div.class('loading')('Loading preview...').build(document));
  }

  _showMessage(cls, message) {
    this.textContent = '';
    this.appendChild(div.class(cls)(message).build(document));
  }

  async load() {
    const newSrc = this.getAttribute('src');
    if (newSrc === this._currentSrc) return;
    this._currentSrc = newSrc;

    if (!newSrc) {
      this._showMessage('preview-binary', 'No source URL');
      return;
    }

    this._showLoading();

    try {
      const response = await fetch(newSrc);
      const text = await response.text();
      const content = text.substring(0, 50000); // cap at 50K chars
      const filename = this.getAttribute('filename') || '';
      const contentType = this.getAttribute('content-type') || 'text/plain';

      this.textContent = '';

      if (this._isMarkdown(filename, contentType)) {
        // Markdown renders to HTML by definition — the regex pipeline
        // below produces an HTML string. We build the wrapper with the
        // element-builder and inject the rendered HTML as its content;
        // there's no clean way to express markdown output as an
        // element-builder tree without rewriting the whole renderer.
        const wrapper = div.class('preview-markdown')().build(document);
        wrapper.innerHTML = this._renderMarkdown(content);
        this.appendChild(wrapper);
      } else {
        this.appendChild(
          pre.class('preview-text')(code(content)).build(document),
        );
      }
    } catch (error) {
      this._showMessage('preview-binary', `Failed to load preview: ${error.message}`);
    }
  }

  _isMarkdown(filename, contentType) {
    if (contentType === 'text/markdown') return true;
    const ext = filename.split('.').pop().toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }

  _renderMarkdown(text) {
    // Simple markdown to HTML conversion
    // Handles: headers, bold, italic, code blocks, inline code, links, lists, paragraphs
    let html = escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="preview-code-block"><code>$2</code></pre>');

    // Headers
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="preview-inline-code">$1</code>');

    // Unordered lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Links [text](url) — but don't create actual clickable links for security
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="preview-link">$1</span>');

    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }
}

customElements.define('aeor-preview-text', AeorPreviewText);
export { AeorPreviewText };
