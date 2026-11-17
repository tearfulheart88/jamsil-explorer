/* P3C local-only product analytics contract. Remote transport is intentionally disabled. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : root);
  else root.WorkspaceAnalytics = factory(root);
})(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  const VERSION = 'decision-analytics/1.0';
  const REMOTE_TRANSPORT = 'OFF';
  const EVENTS = new Set([
    'decision_detail_open', 'decision_axis_expand', 'evidence_drawer_open', 'source_open',
    'timeline_expand', 'compare_add', 'compare_remove', 'compare_open',
    'compare_summary_view', 'next_action_open', 'sort_mode_change', 'decision_data_error',
    'radar_open', 'radar_detail_open'
  ]);
  const ALLOWED_FIELDS = new Set([
    'surface', 'axis', 'sourceType', 'comparisonSize', 'outcome', 'route', 'state',
    'mode', 'sortMode', 'errorKind', 'relation', 'viewportClass'
  ]);
  const ALLOWED_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/;
  const queue = [];

  function sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      if (key === 'comparisonSize' && Number.isInteger(value) && value >= 0 && value <= 4) clean[key] = value;
      else if (typeof value === 'string' && ALLOWED_VALUE.test(value)) clean[key] = value;
    }
    return clean;
  }

  function track(eventName, payload = {}) {
    if (!EVENTS.has(eventName)) return { accepted: false, reason: 'EVENT_NOT_ALLOWED' };
    const event = Object.freeze({ event: eventName, payload: Object.freeze(sanitizePayload(payload)) });
    queue.push(event);
    if (queue.length > 100) queue.shift();
    try {
      if (typeof root?.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('workspace:analytics', { detail: event }));
      }
    } catch (_) {}
    return { accepted: true, event };
  }

  function horizontalOverflow(metrics = {}) {
    const scrollWidth = Number(metrics.scrollWidth);
    const clientWidth = Number(metrics.clientWidth);
    if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth) || clientWidth < 0) return { status: 'INVALID', pixels: null };
    const pixels = Math.max(0, Math.ceil(scrollWidth - clientWidth));
    return { status: pixels === 0 ? 'PASS' : 'OVERFLOW', pixels };
  }

  function peek() { return queue.map(item => ({ event: item.event, payload: { ...item.payload } })); }
  function clear() { queue.length = 0; }

  return Object.freeze({ VERSION, REMOTE_TRANSPORT, EVENTS: Object.freeze([...EVENTS]), track, sanitizePayload, horizontalOverflow, peek, clear });
});
