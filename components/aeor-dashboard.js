/**
 * <aeor-dashboard> — Real-time database dashboard with stats, charts, and health indicators.
 *
 * Connects to SSE at /events/stream?events=metrics and falls back to polling /system/stats.
 * Displays identity info, object counts, storage sizes, throughput rates, health gauges,
 * and live SVG line charts with hover tooltips.
 *
 * Usage:
 *   <aeor-dashboard></aeor-dashboard>
 *   <aeor-dashboard base-url="http://remote:6830"></aeor-dashboard>
 *
 * Without `base-url`, hits the current origin (portal use-case).
 * With `base-url`, hits the specified remote URL (client connections page).
 */

import { elements } from '../../aeor/elements.js';
import { escapeHtml, formatBytes, formatNumber, formatRate, formatBytesRate, formatPercent, formatUptime } from '../utils.js';

const { div, h1, span, svg, text, line, polyline, circle, rect, strong } = elements;

const COUNT_DEFINITIONS = [
  { key: 'files',       label: 'Files',       format: formatNumber },
  { key: 'directories', label: 'Directories', format: formatNumber },
  { key: 'symlinks',    label: 'Symlinks',    format: formatNumber },
  { key: 'chunks',      label: 'Chunks',      format: formatNumber },
  { key: 'snapshots',   label: 'Snapshots',   format: formatNumber },
  { key: 'forks',       label: 'Forks',       format: formatNumber },
];

const SIZE_DEFINITIONS = [
  { key: 'disk_total',    label: 'Disk Total',    format: formatBytes },
  { key: 'logical_data',  label: 'Logical Data',  format: formatBytes },
  { key: 'chunk_data',    label: 'Chunk Data',    format: formatBytes },
  { key: 'dedup_savings', label: 'Dedup Savings', format: formatBytes },
  { key: 'void_space',    label: 'Void Space',    format: formatBytes },
];

const CHART_COLORS = ['#f0883e', '#3fb950', '#d2a8ff', '#58a6ff'];

export class AeorDashboard extends HTMLElement {
  static get observedAttributes() {
    return ['base-url'];
  }

  constructor() {
    super();
    this._interval        = null;
    this._eventSource     = null;
    this._activityHistory = [];
    this._storageChart    = null;
    this._activityChart   = null;
    this._stats           = null;
  }

  connectedCallback() {
    this.render();
    this.fetchStats(); // initial load
    this.connectSSE();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'base-url' && oldValue !== newValue && this.isConnected) {
      // Re-connect to the new target
      this._activityHistory = [];
      this._stats = null;
      this.disconnectedCallback();
      this.render();
      this.fetchStats();
      this.connectSSE();
    }
  }

  /**
   * Prepend the base URL (from the `base-url` attribute) to an API path.
   * When no `base-url` is set the path is returned as-is, hitting the
   * current origin (existing portal behaviour).
   */
  _apiUrl(path) {
    const base = this.getAttribute('base-url') || '';
    return `${base}${path}`;
  }

  disconnectedCallback() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  connectSSE() {
    // Build SSE URL — subscribe to metrics events
    let url = this._apiUrl('/system/events?events=metrics');
    if (typeof window !== 'undefined' && window.AUTH && window.AUTH.token) {
      url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(window.AUTH.token);
    }

    // EventSource doesn't support Authorization headers natively.
    // For --auth=false mode, no token is needed. For auth mode,
    // we'd need a polyfill or query-param token. For now, direct connect.
    try {
      this._eventSource = new EventSource(url);

      this._eventSource.addEventListener('metrics', (event) => {
        try {
          const envelope = JSON.parse(event.data);
          // SSE delivers the full EngineEvent envelope (event_id, event_type,
          // payload, ...). The stats body is in `payload`. Tolerate the older
          // unwrapped shape too in case a peer or proxy strips the envelope.
          const data = envelope && envelope.payload ? envelope.payload : envelope;
          // Identity is static; the pulse omits it. Keep the last seen one
          // (from the initial /system/stats fetch) so the bar doesn't blank.
          this._stats = { ...(this._stats || {}), ...data };
          this.updateIdentityBar(this._stats.identity);
          this.updateStatCards(data);
          this.updateThroughput(data.throughput);
          this.updateHealthIndicators(data.health);
          this.updateStorageChart(data);
          this.recordActivityPoint(data);
          this.updateActivityChart();

          const errorContainer = this.querySelector('#dashboard-error');
          if (errorContainer) errorContainer.textContent = '';
        } catch (_) {
          // malformed event, skip
        }
      });

      this._eventSource.onerror = () => {
        // SSE failed — fall back to polling
        if (this._eventSource) {
          this._eventSource.close();
          this._eventSource = null;
        }
        if (!this._interval) {
          this._interval = setInterval(() => this.fetchStats(), 15000);
        }
      };
    } catch (_) {
      // EventSource not supported — fall back to polling
      this._interval = setInterval(() => this.fetchStats(), 15000);
    }
  }

  render() {
    const statCard = (labelText, valueId) =>
      div.class('stat-card')(
        div.class('stat-label')(labelText),
        div.class('stat-value').id(valueId)('—'),
      );

    const identityCell = (labelText, valueId) =>
      div(
        span.class('identity-label')(labelText),
        ' ',
        span.class('identity-value').id(valueId)('—'),
      );

    this.textContent = '';
    this.appendChild(
      div(
        div.class('page-header')(
          h1.class('page-title')('Dashboard'),
        ),
        div.id('identity-bar').class('identity-bar')(
          identityCell('Version', 'identity-version'),
          identityCell('Database', 'identity-database-path'),
          identityCell('Uptime', 'identity-uptime'),
          identityCell('Hash', 'identity-hash-algorithm'),
        ),
        div.id('dashboard-error')(),

        div.class('section-heading')('Counts'),
        div.class('stats-grid').id('stats-counts')(
          ...COUNT_DEFINITIONS.map((d) => statCard(d.label, `stat-count-${d.key}`)),
        ),

        div.class('section-heading')('Sizes'),
        div.class('stats-grid').id('stats-sizes')(
          ...SIZE_DEFINITIONS.map((d) => statCard(d.label, `stat-size-${d.key}`)),
        ),

        div.class('section-heading')('Throughput'),
        div.class('stats-grid').id('stats-throughput')(
          statCard('Writes / sec (1m)', 'stat-writes-per-sec'),
          statCard('Reads / sec (1m)', 'stat-reads-per-sec'),
          statCard('Write rate (1m)', 'stat-bytes-written-per-sec'),
          statCard('Read rate (1m)', 'stat-bytes-read-per-sec'),
        ),

        div.class('section-heading')('Health'),
        div.class('stats-grid').id('stats-health')(
          div.class('stat-card')(
            div.class('stat-label')('Disk Usage'),
            div.id('health-disk-usage').class('health-disk-usage')(
              div.class('health-disk-row')(
                span.class('health-disk-label')('Usage'),
                span.class('health-disk-value').id('health-disk-usage-value')('—'),
              ),
              div.class('progress-track')(
                div.id('health-disk-usage-bar').class('progress-fill')(),
              ),
            ),
          ),
          statCard('Dedup Hit Rate', 'health-dedup-hit-rate'),
          statCard('Write Buffer Depth', 'health-write-buffer-depth'),
        ),

        div.class('charts-row')(
          div.class('chart-card')(
            div.class('chart-title')('Activity (ops/sec)'),
            div.class('chart-container').id('chart-activity')(),
          ),
          div.class('chart-card')(
            div.class('chart-title')('Throughput (bytes/sec)'),
            div.class('chart-container').id('chart-throughput')(),
          ),
        ),
        div.class('charts-row')(
          div.class('chart-card')(
            div.class('chart-title')('Storage Overview'),
            div.class('chart-container').id('chart-storage')(),
          ),
          div.class('chart-card chart-card-placeholder')(
            div.class('chart-placeholder-text')('Additional charts coming soon'),
          ),
        ),
      ).build(document),
    );
  }

  async fetchStats() {
    try {
      const url = this._apiUrl('/system/stats');
      const response = await fetch(url);

      if (!response.ok)
        throw new Error(`Stats request failed (${response.status})`);

      const data = await response.json();
      this._stats = data;

      this.updateIdentityBar(data.identity);
      this.updateStatCards(data);
      this.updateThroughput(data.throughput);
      this.updateHealthIndicators(data.health);
      this.updateStorageChart(data);
      this.recordActivityPoint(data);
      this.updateActivityChart();

      const errorContainer = this.querySelector('#dashboard-error');
      if (errorContainer) errorContainer.textContent = '';
    } catch (error) {
      const errorContainer = this.querySelector('#dashboard-error');
      if (errorContainer) {
        errorContainer.textContent = '';
        errorContainer.appendChild(
          div.class('alert alert-error')(`Failed to load stats: ${error.message}`).build(document),
        );
      }
    }
  }

  updateIdentityBar(identity) {
    if (!identity)
      return;

    const versionElement      = this.querySelector('#identity-version');
    const databasePathElement = this.querySelector('#identity-database-path');
    const uptimeElement       = this.querySelector('#identity-uptime');
    const hashAlgorithmElement = this.querySelector('#identity-hash-algorithm');

    if (versionElement)
      versionElement.textContent = identity.version || '\u2014';

    if (databasePathElement)
      databasePathElement.textContent = identity.database_path || '\u2014';

    if (uptimeElement)
      uptimeElement.textContent = formatUptime(identity.uptime_seconds);

    if (hashAlgorithmElement)
      hashAlgorithmElement.textContent = identity.hash_algorithm || '\u2014';
  }

  updateStatCards(data) {
    const counts = data.counts || {};
    const sizes  = data.sizes || {};

    for (const definition of COUNT_DEFINITIONS) {
      const element = this.querySelector(`#stat-count-${definition.key}`);
      if (!element)
        continue;

      const value = counts[definition.key];
      element.textContent = (value != null) ? definition.format(value) : '\u2014';
    }

    for (const definition of SIZE_DEFINITIONS) {
      const element = this.querySelector(`#stat-size-${definition.key}`);
      if (!element)
        continue;

      const value = sizes[definition.key];
      element.textContent = (value != null) ? definition.format(value) : '\u2014';
    }
  }

  updateThroughput(throughput) {
    if (!throughput)
      return;

    const writesElement = this.querySelector('#stat-writes-per-sec');
    const readsElement  = this.querySelector('#stat-reads-per-sec');

    if (writesElement) {
      const rate = throughput.writes_per_sec?.['1m'];
      writesElement.textContent = formatRate(rate);
    }

    if (readsElement) {
      const rate = throughput.reads_per_sec?.['1m'];
      readsElement.textContent = formatRate(rate);
    }

    const bytesWrittenElement = this.querySelector('#stat-bytes-written-per-sec');
    if (bytesWrittenElement) {
      const rate = throughput.bytes_written_per_sec?.['1m'];
      bytesWrittenElement.textContent = formatBytesRate(rate);
    }

    const bytesReadElement = this.querySelector('#stat-bytes-read-per-sec');
    if (bytesReadElement) {
      const rate = throughput.bytes_read_per_sec?.['1m'];
      bytesReadElement.textContent = formatBytesRate(rate);
    }
  }

  updateHealthIndicators(health) {
    if (!health)
      return;

    // Disk usage percentage bar
    const diskUsageValue = this.querySelector('#health-disk-usage-value');
    const diskUsageBar   = this.querySelector('#health-disk-usage-bar');

    if (diskUsageValue && diskUsageBar) {
      const percent = health.disk_usage_percent;
      diskUsageValue.textContent = formatPercent(percent);

      if (percent != null) {
        diskUsageBar.style.width = Math.min(percent, 100) + '%';

        // Color based on usage level via CSS data-level attribute
        if (percent >= 90) {
          diskUsageBar.dataset.level = 'danger';
        } else if (percent >= 75) {
          diskUsageBar.dataset.level = 'warning';
        } else {
          delete diskUsageBar.dataset.level;
        }
      }
    }

    // Dedup hit rate
    const dedupElement = this.querySelector('#health-dedup-hit-rate');
    if (dedupElement)
      dedupElement.textContent = formatPercent(health.dedup_hit_rate);

    // Write buffer depth
    const bufferElement = this.querySelector('#health-write-buffer-depth');
    if (bufferElement)
      bufferElement.textContent = (health.write_buffer_depth != null) ? formatNumber(health.write_buffer_depth) : '\u2014';
  }

  updateStorageChart(data) {
    const container = this.querySelector('#chart-storage');
    if (!container) return;

    const counts = data.counts || {};
    const labels = ['Chunks', 'Files', 'Directories', 'Snapshots'];
    const values = [
      counts.chunks || 0,
      counts.files || 0,
      counts.directories || 0,
      counts.snapshots || 0,
    ];

    container.textContent = '';
    this.renderBarChart(container, labels, values);
  }

  renderBarChart(container, labels, values) {
    const maxValue = Math.max(...values, 1);

    const rows = labels.map((labelText, index) => {
      const percentage = (values[index] / maxValue) * 100;
      const color = CHART_COLORS[index % CHART_COLORS.length];
      return div.class('bar-chart-row')(
        div.class('bar-chart-header')(
          span.class('bar-chart-label')(labelText),
          span.class('bar-chart-value')(formatNumber(values[index])),
        ),
        div.class('bar-track')(
          div.class('bar-fill').style(`background:${color};width:${Math.max(percentage, 1)}%`)(),
        ),
      );
    });

    container.appendChild(div.class('bar-chart')(...rows).build(document));
  }

  recordActivityPoint(data) {
    const writesPerSecond = data.throughput?.writes_per_sec?.['1m'] || 0;
    const readsPerSecond = data.throughput?.reads_per_sec?.['1m'] || 0;
    const bytesWrittenPerSecond = data.throughput?.bytes_written_per_sec?.['1m'] || 0;
    const bytesReadPerSecond = data.throughput?.bytes_read_per_sec?.['1m'] || 0;

    this._activityHistory.push({
      timestamp: Date.now(),
      writesPerSecond,
      readsPerSecond,
      bytesWrittenPerSecond,
      bytesReadPerSecond,
    });

    // Keep rolling window of 60 data points (15 minutes at 15s metrics intervals)
    if (this._activityHistory.length > 60)
      this._activityHistory.shift();
  }

  updateActivityChart() {
    const history = this._activityHistory;
    const showWaiting = (container) => {
      container.textContent = '';
      container.appendChild(div.class('chart-waiting')('Collecting data...').build(document));
    };

    const opsContainer = this.querySelector('#chart-activity');
    if (opsContainer) {
      if (history.length < 2) {
        showWaiting(opsContainer);
      } else {
        this.renderDualLineChart(opsContainer, history, 'writesPerSecond', 'readsPerSecond', 'writes', 'reads', formatRate);
      }
    }

    const throughputContainer = this.querySelector('#chart-throughput');
    if (throughputContainer) {
      if (history.length < 2) {
        showWaiting(throughputContainer);
      } else {
        this.renderDualLineChart(throughputContainer, history, 'bytesWrittenPerSecond', 'bytesReadPerSecond', 'written', 'read', formatBytesRate);
      }
    }
  }

  renderDualLineChart(container, history, orangeKey, greenKey, orangeLabel, greenLabel, formatter) {
    const width = container.clientWidth || 400;
    const height = 220;
    const paddingLeft = 70;
    const paddingRight = 16;
    const paddingTop = 24;
    const paddingBottom = 30;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Compute shared Y-axis range from both series
    const allValues = history.flatMap((p) => [p[orangeKey] || 0, p[greenKey] || 0]);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = maxValue - minValue || 1;

    const toX = (index) => paddingLeft + (index / (history.length - 1)) * chartWidth;
    const toY = (value) => paddingTop + chartHeight - (((value || 0) - minValue) / range) * chartHeight;

    const orangePoints = history.map((p, i) => `${toX(i)},${toY(p[orangeKey])}`).join(' ');
    const greenPoints = history.map((p, i) => `${toX(i)},${toY(p[greenKey])}`).join(' ');

    const monoLabel = (x, y, anchor, fill, content) =>
      text.x(String(x)).y(String(y))
        .textAnchor(anchor)
        .fill(fill)
        .fontSize('10')
        .fontFamily('var(--font-mono)')(content);

    // Y-axis labels + grid lines
    const yLabelCount = 4;
    const yLabelEls = [];
    for (let index = 0; index <= yLabelCount; index++) {
      const value = minValue + (range * index / yLabelCount);
      const y = paddingTop + chartHeight - (index / yLabelCount) * chartHeight;
      yLabelEls.push(monoLabel(paddingLeft - 8, y + 4, 'end', '#8b949e', formatter(value)));
      yLabelEls.push(
        line
          .x1(String(paddingLeft)).y1(String(y))
          .x2(String(width - paddingRight)).y2(String(y))
          .stroke('#30363d').strokeWidth('1')(),
      );
    }

    // X-axis time labels
    const timeLabelEls = [];
    const labelCount = Math.min(5, history.length);
    for (let index = 0; index < labelCount; index++) {
      const dataIndex = Math.floor(index * (history.length - 1) / (labelCount - 1));
      const x = toX(dataIndex);
      const time = new Date(history[dataIndex].timestamp);
      const labelText = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
      timeLabelEls.push(monoLabel(x, height - 4, 'middle', '#8b949e', labelText));
    }

    // Legend
    const legendY = 12;
    const legendEls = [
      circle.cx(String(paddingLeft + 4)).cy(String(legendY)).r('4').fill('#f0883e')(),
      monoLabel(paddingLeft + 12, legendY + 4, 'start', '#f0883e', orangeLabel),
      circle.cx(String(paddingLeft + 14 + orangeLabel.length * 6)).cy(String(legendY)).r('4').fill('#3fb950')(),
      monoLabel(paddingLeft + 22 + orangeLabel.length * 6, legendY + 4, 'start', '#3fb950', greenLabel),
    ];

    // Hover overlay (line, two dots) — hidden until mousemove fires.
    const hoverId = `hover-${orangeKey}-${Date.now()}`;
    const hoverEls = [
      line.id(`${hoverId}-line`)
        .x1('0').y1(String(paddingTop))
        .x2('0').y2(String(paddingTop + chartHeight))
        .stroke('#8b949e').strokeWidth('1').strokeDasharray('3,3').visibility('hidden')(),
      circle.id(`${hoverId}-dot-orange`).r('4').fill('#f0883e')
        .stroke('#0f1117').strokeWidth('2').visibility('hidden')(),
      circle.id(`${hoverId}-dot-green`).r('4').fill('#3fb950')
        .stroke('#0f1117').strokeWidth('2').visibility('hidden')(),
    ];

    // Invisible per-data-point hit areas to snap the hover to the nearest point.
    const hitEls = [];
    for (let i = 0; i < history.length; i++) {
      const x = toX(i);
      const halfGap = (i < history.length - 1)
        ? (toX(i + 1) - x) / 2
        : (x - toX(Math.max(0, i - 1))) / 2;
      hitEls.push(
        rect.x(String(x - halfGap)).y(String(paddingTop))
          .width(String(halfGap * 2)).height(String(chartHeight))
          .fill('transparent').dataIdx(String(i))(),
      );
    }

    container.classList.add('chart-container-relative');
    container.textContent = '';
    container.appendChild(
      svg
        .width(String(width)).height(String(height))
        .viewBox(`0 0 ${width} ${height}`)
        .class('chart-svg')(
          ...yLabelEls,
          ...timeLabelEls,
          ...legendEls,
          polyline.points(orangePoints).fill('none').stroke('#f0883e')
            .strokeWidth('2').strokeLinejoin('round').strokeLinecap('round')(),
          polyline.points(greenPoints).fill('none').stroke('#3fb950')
            .strokeWidth('2').strokeLinejoin('round').strokeLinecap('round')(),
          ...hoverEls,
          ...hitEls,
        ).build(document),
    );
    container.appendChild(
      div.id(`${hoverId}-tooltip`).class('chart-tooltip')().build(document),
    );

    // Wire hover events. Local names avoid shadowing the module-level
    // `svg` / `rect` element-builder bindings (const/let hoisting would
    // otherwise put them in the TDZ for the entire function body).
    const svgEl = container.querySelector('svg');
    const hoverLine = container.querySelector(`#${hoverId}-line`);
    const dotOrange = container.querySelector(`#${hoverId}-dot-orange`);
    const dotGreen = container.querySelector(`#${hoverId}-dot-green`);
    const tooltip = container.querySelector(`#${hoverId}-tooltip`);

    svgEl.addEventListener('mousemove', (e) => {
      const svgRect = svgEl.getBoundingClientRect();
      const mouseX = e.clientX - svgRect.left;
      // Find nearest data point
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < history.length; i++) {
        const dist = Math.abs(toX(i) - mouseX);
        if (dist < nearestDist) { nearestDist = dist; nearest = i; }
      }

      const x = toX(nearest);
      const p = history[nearest];
      const oyVal = p[orangeKey] || 0;
      const gyVal = p[greenKey] || 0;

      hoverLine.setAttribute('x1', x);
      hoverLine.setAttribute('x2', x);
      hoverLine.setAttribute('visibility', 'visible');

      dotOrange.setAttribute('cx', x);
      dotOrange.setAttribute('cy', toY(oyVal));
      dotOrange.setAttribute('visibility', 'visible');

      dotGreen.setAttribute('cx', x);
      dotGreen.setAttribute('cy', toY(gyVal));
      dotGreen.setAttribute('visibility', 'visible');

      const time = new Date(p.timestamp);
      const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
      tooltip.textContent = '';
      tooltip.appendChild(
        div(
          div.class('tooltip-time')(timeStr),
          div(
            span.class('tooltip-dot-orange')('\u25CF'),
            ` ${orangeLabel}: `,
            strong(formatter(oyVal)),
          ),
          div(
            span.class('tooltip-dot-green')('\u25CF'),
            ` ${greenLabel}: `,
            strong(formatter(gyVal)),
          ),
        ).build(document),
      );
      tooltip.style.display = 'block';

      // Position tooltip — flip to left side if near right edge
      const tooltipX = (x + 16 + 140 > width) ? x - 150 : x + 16;
      tooltip.style.left = `${tooltipX}px`;
      tooltip.style.top = `${paddingTop}px`;
    });

    svgEl.addEventListener('mouseleave', () => {
      hoverLine.setAttribute('visibility', 'hidden');
      dotOrange.setAttribute('visibility', 'hidden');
      dotGreen.setAttribute('visibility', 'hidden');
      tooltip.style.display = 'none';
    });
  }
}

if (!customElements.get('aeor-dashboard'))
  customElements.define('aeor-dashboard', AeorDashboard);
