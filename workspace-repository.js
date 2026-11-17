/* Immutable, read-only repositories for PublicBundle/ProjectBundle 1.0. No credentials or profile persistence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./workspace-schemas.js'));
  else root.WorkspaceRepository = factory(root.WorkspaceSchemas);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Schemas) {
  'use strict';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const arrays = ['properties', 'listings', 'projects', 'events', 'plans', 'membershipLinks', 'claims', 'evidence'];
  const legacyKeys = new Set(('id property_key rank inv region sgg dong apt kind lat lon price deals area floor price_basis transaction_date latest_transaction_price latest_transaction_area transaction_samples prior_deals listing_status asking_price listing_verified_at year age old_share trend bench bench_label market_signals far_est far_cap far_actual far_basis far_collected_at far_identity_scope far_identity_verified far_headroom far_cap_verified far_cap_note households households_scope zone land_share land_share_basis land_share_source land_share_sample_count land_share_evidence land_price station ppm_cheap stores parcel jeonse occupancy regulated commute mgmt interior redev link link_kind hogangnono_url hogangnono_link_kind source_collected_at source_status observed_listing_count parcel_zone seoul_zone naver_search address buy price_legacy_90d area_legacy').split(' '));
  const privateKey = /^(?:cash|reserve|income|debt|debts|profile|private_profile|cashAvailableKrw|annualGrossIncomeKrw|monthlyNetIncomeKrw|api[_-]?key|servicekey|access_token|password|secret|authorization|workplaces|exactLocation)$/i;
  function safeLegacy(item) {
    function scrub(value) {
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !privateKey.test(k)).map(([k, v]) => [k, scrub(v)]));
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && !isSafePublicUrl(value)) return null;
      return value;
    }
    return scrub(Object.fromEntries(Object.entries(item || {}).filter(([k]) => legacyKeys.has(k))));
  }
  function hydrateLegacy(raw, catalog = {}) {
    const item = clone(raw), decode = v => typeof v === 'number' ? (catalog.texts || [])[v] ?? String(v) : v;
    const list = v => (v || []).map(decode), signals = item.market_signals, inv = item.inv;
    if (signals) {
      signals.windows = signals.windows || catalog.market_signals_windows;
      if (signals.pattern) signals.pattern = { ...(catalog.market_signal_patterns || {})[signals.pattern.key], ...signals.pattern };
      if (!signals.coverage && signals.coverage_id != null) signals.coverage = (catalog.market_signal_coverage || [])[signals.coverage_id];
      if (signals.confidence) signals.confidence.reasons = list(signals.confidence.reasons);
    }
    if (inv) {
      inv.methodology = inv.methodology || catalog.methodology;
      for (const category of inv.cats || []) category.it = (category.it || []).map(i => {
        if (!Array.isArray(i)) return { ...(catalog.indicators || {})[i.k], ...i };
        const [k, v = null, p = null, contribution = 0, evidenceWeight = 0, sourceId = null, status, weight] = i;
        const restored = { ...(catalog.indicators || {})[k], k, v, p, contribution: contribution ?? 0, evidence_weight_pct: evidenceWeight ?? 0, source_basis: sourceId == null ? null : decode(sourceId), status: status || (v == null ? 'missing' : p == null ? 'reference' : 'scored') };
        if (weight != null) restored.weight = weight;
        return restored;
      });
      inv.evidence_checks = (inv.evidence_checks || []).map(c => ({ label: (catalog.evidence_checks || {})[c.key], ...c }));
      inv.missing_checks = list(inv.missing_checks);
      if (inv.purchase_assessment) inv.purchase_assessment.missing_checks = list(inv.purchase_assessment.missing_checks);
      if (inv.assessment) inv.assessment.reasons = list(inv.assessment.reasons);
      if (inv.recommendation) {
        inv.recommendation.reasons = list(inv.recommendation.reasons); inv.recommendation.limitations = list(inv.recommendation.limitations);
        inv.recommendation.theses = (inv.recommendation.theses || []).map(t => ({ ...(catalog.thesis_templates || {})[t.template_id || t.key], ...t }));
      }
      if (inv.peer_price_comparison) inv.peer_price_comparison = { ...catalog.peer_price_comparison, ...inv.peer_price_comparison };
    }
    return item;
  }
  function unpackContext(raw, shard, propertyId) {
    if (!raw || !own(raw, 'transactionRecords')) return raw;
    if (shard.transactionPackingVersion !== 1) throw new RepositoryError('PACKING_VERSION', 'Unsupported transaction packing version');
    const context = { ...raw, transactions: [], evidence: [] };
    for (const record of raw.transactionRecords) {
      if (!Array.isArray(record) || record.length !== 9) throw new RepositoryError('VALIDATION', 'Malformed packed source record');
      const [batchIndex, occurrenceIndex, date, area, price, floor, status, cancellationDate, excerpt] = record;
      const batch = (shard.sourceBatches || [])[batchIndex];
      if (!batch || !Number.isInteger(batchIndex)) throw new RepositoryError('VALIDATION', 'Missing packed source batch');
      const parts = batch.sourceBatchId.split('@'), hash = parts[parts.length - 1];
      if (!/^[a-f0-9]{20}$/.test(hash)) throw new RepositoryError('VALIDATION', 'Invalid source batch hash');
      const eid = `rtms-evidence:${hash}:${occurrenceIndex}`;
      context.transactions.push({ id: `rtms:${hash}:${occurrenceIndex}`, isDemo: false, propertyId, sourceRecordId: null,
        sourceBatchId: batch.sourceBatchId, occurrenceIndex, contractDate: date, exclusiveAreaSqm: area, priceKrw: price,
        floor, status, revisionOf: null, cancellationDate, evidenceIds: [eid] });
      context.evidence.push({ ...batch.evidence, id: eid, observedOn: date, excerpt,
        locator: { kind: 'structured_record', label: `${parts[0]} · rows[${occurrenceIndex}]`, recordKey: `${batch.sourceBatchId}#rows/${occurrenceIndex}` } });
    }
    delete context.transactionRecords;
    return context;
  }
  const error = (path, code, message) => ({ path, code, message });
  function dateOK(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function dateTimeOK(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
    const m = value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/);
    return dateOK(value.slice(0, 10)) && +m[1] < 24 && +m[2] < 60 && +m[3] < 60 &&
      (m[4] === 'Z' || (+m[6] <= 23 && +m[7] < 60)) && Number.isFinite(Date.parse(value));
  }
  // Links are opened by the browser only. This validator never fetches an evidence URL.
  function isSafePublicUrl(value) {
    try {
      const u = new URL(value), h = u.hostname.toLowerCase();
      if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
      if (!h.includes('.') || h.endsWith('.') || h.includes(':') || /^[\d.]+$/.test(h)) return false;
      if (/(^|\.)(localhost|local|internal|lan|test|invalid)$/.test(h) || h.endsWith('.localhost')) return false;
      for (const key of u.searchParams.keys()) if (/^(?:api[_-]?key|servicekey|token|access_token|password|secret|authorization)$/i.test(key)) return false;
      return true;
    } catch (_) { return false; }
  }
  function schemaErrors(value, schema, root = schema, path = '$', out = []) {
    if (!schema || typeof schema !== 'object') return out;
    if (schema.$ref) {
      const target = schema.$ref.split('/').slice(1).reduce((v, k) => v && v[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
      if (!target) out.push(error(path, 'schema_ref', 'Unknown local schema reference'));
      else schemaErrors(value, target, root, path, out);
      return out;
    }
    const matches = sub => schemaErrors(value, sub, root, path, []).length === 0;
    if (own(schema, 'const') && value !== schema.const) out.push(error(path, 'const', 'Unexpected constant'));
    if (schema.enum && !schema.enum.includes(value)) out.push(error(path, 'enum', 'Value outside allowed enum'));
    if (schema.not && matches(schema.not)) out.push(error(path, 'not', 'Disallowed value'));
    if (schema.anyOf && !schema.anyOf.some(matches)) out.push(error(path, 'anyOf', 'Value does not match allowed alternatives'));
    if (schema.allOf) for (const sub of schema.allOf) schemaErrors(value, sub, root, path, out);
    if (schema.if && matches(schema.if)) schemaErrors(value, schema.then, root, path, out);
    if (schema.if && !matches(schema.if)) schemaErrors(value, schema.else, root, path, out);
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const ok = types.some(t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) :
        t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) :
        t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t);
      if (!ok) { out.push(error(path, 'type', 'Unexpected value type')); return out; }
    }
    if (typeof value === 'string') {
      if (schema.minLength != null && value.length < schema.minLength) out.push(error(path, 'minLength', 'String is too short'));
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(error(path, 'pattern', 'String format is invalid'));
      if (schema.format === 'date' && !dateOK(value)) out.push(error(path, 'date', 'Expected a real ISO calendar date'));
      if (schema.format === 'date-time' && !dateTimeOK(value)) out.push(error(path, 'date-time', 'Expected an ISO date-time with timezone'));
      if (schema.format === 'uri') { try { new URL(value); } catch (_) { out.push(error(path, 'uri', 'Expected absolute URL')); } }
    }
    if (typeof value === 'number') {
      for (const [key, failed] of [['minimum', value < schema.minimum], ['maximum', value > schema.maximum], ['exclusiveMinimum', value <= schema.exclusiveMinimum]])
        if (schema[key] != null && failed) out.push(error(path, key, 'Number outside allowed bounds'));
    }
    if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) out.push(error(path, 'minItems', 'Array has too few items'));
      if (schema.items) value.forEach((v, i) => schemaErrors(v, schema.items, root, `${path}[${i}]`, out));
    } else if (value !== null && typeof value === 'object') {
      for (const key of schema.required || []) if (!own(value, key)) out.push(error(path + '.' + key, 'required', 'Required field is missing'));
      for (const key of Object.keys(value)) {
        if (schema.properties && own(schema.properties, key)) schemaErrors(value[key], schema.properties[key], root, path + '.' + key, out);
        else if (schema.additionalProperties === false) out.push(error(path + '.' + key, 'additionalProperties', 'Field is not in the public contract'));
      }
    }
    return out;
  }
  function emptyProject(bundle) {
    return { schemaVersion: '1.0', snapshotId: bundle.snapshotId, dataMode: bundle.dataMode, generatedAt: bundle.generatedAt,
      projects: [], events: [], plans: [], membershipLinks: [], claims: [], evidence: [] };
  }
  function semanticErrors(bundle, project, options = {}) {
    const out = [], maps = Object.fromEntries(arrays.map(k => [k, new Map()]));
    for (const [scope, data] of [['public', bundle], ['project', project]]) {
      if (!data) continue;
      if (data.snapshotId !== bundle.snapshotId || data.dataMode !== bundle.dataMode) out.push(error(scope, 'snapshot_mode', 'Snapshot and data mode must match'));
      for (const key of arrays) {
        const seen = new Set();
        for (const item of data[key] || []) {
          if (seen.has(item.id)) out.push(error(scope + '.' + key, 'duplicate_id', 'Duplicate record ID'));
          seen.add(item.id);
          if (maps[key].has(item.id) && JSON.stringify(maps[key].get(item.id)) !== JSON.stringify(item)) out.push(error(scope + '.' + key, 'conflicting_id', 'Same ID has different content'));
          maps[key].set(item.id, item);
          if (item.isDemo !== (bundle.dataMode === 'demo')) out.push(error(scope + '.' + key, 'data_mode', 'Demo and live records must not mix'));
        }
      }
    }
    const ref = (key, id, path) => { if (id != null && !maps[key].has(id)) out.push(error(path, 'missing_reference', 'Referenced ' + key + ' record is missing')); };
    const refs = (key, ids, path) => (ids || []).forEach(id => ref(key, id, path));
    for (const p of maps.properties.values()) {
      refs('claims', p.claimIds, 'property.claimIds'); refs('listings', p.listingIds, 'property.listingIds'); refs('projects', p.projectIds, 'property.projectIds');
      if (p.currentPrice) {
        ref('claims', p.currentPrice.claimId, 'property.currentPrice.claimId');
        const c = maps.claims.get(p.currentPrice.claimId);
        if (c && (c.subjectId !== p.id || String(c.value) !== p.currentPrice.amountKrw || c.unit !== 'KRW')) out.push(error('property.currentPrice', 'price_claim', 'Price must match its own KRW claim'));
      }
    }
    for (const e of maps.evidence.values()) {
      if (e.url != null && !isSafePublicUrl(e.url)) out.push(error('evidence.url', 'unsafe_url', 'Only public HTTPS source URLs without secrets are allowed'));
      if (e.effectiveFrom && e.effectiveTo && e.effectiveFrom > e.effectiveTo) out.push(error('evidence', 'date_order', 'Effective date range is reversed'));
      if (e.locator.kind === 'structured_record' && !e.locator.recordKey) out.push(error('evidence.locator', 'record_locator', 'Structured evidence needs an exact record key'));
    }
    const subjects = new Set([...maps.properties.keys(), ...maps.listings.keys(), ...maps.projects.keys(), ...maps.events.keys(), ...maps.plans.keys()]);
    for (const c of maps.claims.values()) {
      if (!subjects.has(c.subjectId)) out.push(error('claim.subjectId', 'missing_reference', 'Claim subject is missing'));
      for (const e of c.evidence || []) ref('evidence', e.evidenceId, 'claim.evidence');
      const supports = (c.evidence || []).filter(e => e.relation === 'supports');
      if (c.state === 'confirmed' && (!supports.length || c.evidence.some(e => e.relation === 'contradicts'))) out.push(error('claim.state', 'claim_support', 'Confirmed claims require support and cannot hide contradicting evidence'));
      if (c.state === 'confirmed' && bundle.dataMode === 'live') {
        for (const link of supports) {
          const e = maps.evidence.get(link.evidenceId);
          if (e && e.locator.kind === 'web' && (!e.locator.heading || !e.url || new URL(e.url).pathname === '/')) out.push(error('claim.evidence', 'imprecise_source', 'A portal home or a page without a locator cannot confirm a claim'));
          if (e && e.locator.kind === 'local_demo') out.push(error('claim.evidence', 'demo_locator', 'Live claims cannot use demo locators'));
        }
      }
      if (c.validFrom && c.validTo && c.validFrom > c.validTo) out.push(error('claim', 'date_order', 'Claim validity date range is reversed'));
      if (options.calculationIds && c.calculationId && !options.calculationIds.includes(c.calculationId)) out.push(error('claim.calculationId', 'missing_reference', 'Calculation sidecar reference is missing'));
      if (options.assumptionIds) for (const id of c.assumptionIds || []) if (!options.assumptionIds.includes(id)) out.push(error('claim.assumptionIds', 'missing_reference', 'Assumption sidecar reference is missing'));
    }
    for (const l of maps.listings.values()) {
      ref('properties', l.propertyId, 'listing.propertyId'); refs('evidence', l.evidenceIds, 'listing.evidenceIds');
      if (l.checkedAt && l.expiresAt && Date.parse(l.checkedAt) >= Date.parse(l.expiresAt)) out.push(error('listing.expiresAt', 'date_order', 'Listing expiry must be after checking'));
      const p = maps.properties.get(l.propertyId);
      if (p && !p.listingIds.includes(l.id)) out.push(error('listing.propertyId', 'back_reference', 'Property must list the linked listing'));
    }
    for (const p of maps.projects.values()) {
      refs('events', p.eventIds, 'project.eventIds'); refs('plans', p.planVersionIds, 'project.planVersionIds'); refs('claims', p.claimIds, 'project.claimIds'); ref('claims', p.stageClaimId, 'project.stageClaimId');
      for (const condition of p.nextConditions) refs('claims', condition.claimIds, 'project.nextConditions');
    }
    for (const e of maps.events.values()) {
      ref('projects', e.projectId, 'event.projectId'); ref('claims', e.claimId, 'event.claimId'); refs('evidence', e.evidenceIds, 'event.evidenceIds'); ref('events', e.supersedes, 'event.supersedes');
      if (e.supersedes === e.id) out.push(error('event.supersedes', 'self_reference', 'An event cannot supersede itself'));
    }
    for (const p of maps.plans.values()) {
      ref('projects', p.projectId, 'plan.projectId'); refs('claims', p.claimIds, 'plan.claimIds'); refs('evidence', p.evidenceIds, 'plan.evidenceIds');
      for (const k of ['areaBasisClaimId', 'plannedFarClaimId', 'memberAreaClaimId', 'otherAreaClaimId', 'totalCostClaimId', 'completionTargetClaimId']) ref('claims', p[k], 'plan.' + k);
    }
    for (const m of maps.membershipLinks.values()) {
      ref('properties', m.propertyId, 'membership.propertyId'); ref('projects', m.projectId, 'membership.projectId'); refs('evidence', m.evidenceIds, 'membership.evidenceIds');
      if (m.relation === 'direct_confirmed' && (m.method !== 'official_parcel_document_review' || m.reviewStatus !== 'verified_scope' || !m.evidenceIds.length)) out.push(error('membership.relation', 'membership_scope', 'Confirmed membership needs reviewed official parcel evidence'));
    }
    if (bundle.coverage) {
      const { requested, available, missing } = bundle.coverage;
      if ([...available, ...missing].some(x => !requested.includes(x)) || available.some(x => missing.includes(x)) || requested.some(x => !available.includes(x) && !missing.includes(x))) out.push(error('coverage', 'coverage_partition', 'Requested coverage must be partitioned into available and missing'));
      if (bundle.status === 'complete' && missing.length) out.push(error('status', 'incomplete_coverage', 'Missing coverage cannot be complete'));
    }
    return out;
  }
  function validatePublicBundle(bundle, options = {}) {
    if (!Schemas) return { valid: false, errors: [error('$', 'schema_unavailable', 'Load workspace-schemas.js first')] };
    const errors = schemaErrors(bundle, Schemas.publicBundle);
    const project = options.projectBundle || (bundle && emptyProject(bundle));
    if (options.projectBundle) errors.push(...schemaErrors(project, Schemas.projectBundle));
    if (!errors.length) errors.push(...semanticErrors(bundle, project, options));
    return { valid: errors.length === 0, errors };
  }
  function validateProjectBundle(project, options = {}) {
    const errors = schemaErrors(project, Schemas.projectBundle);
    if (options.publicBundle) errors.push(...schemaErrors(options.publicBundle, Schemas.publicBundle));
    if (!errors.length) {
      const publicBundle = options.publicBundle || { ...project, properties: [], listings: [], claims: [], evidence: [], coverage: { requested: [], available: [], missing: [] } };
      errors.push(...semanticErrors(publicBundle, project, options));
    }
    return { valid: errors.length === 0, errors };
  }
  class RepositoryError extends Error {
    constructor(code, message, details = []) { super(message); this.name = code === 'VALIDATION' ? 'ValidationError' : 'RepositoryError'; this.code = code; this.details = details; }
  }
  function checkTransactions(transactions, bundle, project) {
    const errors = [], ids = new Set(), evidence = new Set([...bundle.evidence, ...project.evidence].map(x => x.id)), props = new Set(bundle.properties.map(x => x.id));
    for (const t of transactions) {
      errors.push(...schemaErrors(t, Schemas.transaction));
      if (ids.has(t.id)) errors.push(error('transactions', 'duplicate_id', 'Duplicate transaction ID'));
      ids.add(t.id);
      if (t.isDemo !== (bundle.dataMode === 'demo')) errors.push(error('transaction.isDemo', 'data_mode', 'Transaction mode must match snapshot'));
      if (!props.has(t.propertyId)) errors.push(error('transaction.propertyId', 'missing_reference', 'Transaction property missing'));
      for (const id of t.evidenceIds || []) if (!evidence.has(id)) errors.push(error('transaction.evidenceIds', 'missing_reference', 'Transaction evidence missing'));
      if (!t.isDemo && !(t.evidenceIds || []).length) errors.push(error('transaction.evidenceIds', 'source_record', 'Live transactions require traceable source evidence'));
      if (t.cancellationDate && t.contractDate > t.cancellationDate) errors.push(error('transaction.cancellationDate', 'date_order', 'Cancellation precedes contract'));
    }
    for (const t of transactions) if (t.revisionOf && (!ids.has(t.revisionOf) || t.revisionOf === t.id)) errors.push(error('transaction.revisionOf', 'missing_reference', 'Revision needs a distinct source transaction'));
    return errors;
  }
  class SnapshotRepository {
    constructor(bundle, options = {}) {
      const result = validatePublicBundle(bundle, options);
      if (!result.valid) throw new RepositoryError('VALIDATION', 'Snapshot validation failed', result.errors);
      this._bundle = clone(bundle); this._project = clone(options.projectBundle || emptyProject(bundle));
      this._transactions = clone(options.transactions || []);
      const errors = checkTransactions(this._transactions, this._bundle, this._project);
      if (errors.length) throw new RepositoryError('VALIDATION', 'Transaction validation failed', errors);
      this._legacy = Object.fromEntries(Object.entries(options.legacyContexts || {}).map(([id, item]) => [id, safeLegacy(item)])); this._contextLoader = options.contextLoader || null;
      this._contextCache = new Map(); this._now = options.now || (() => Date.now());
      this._sidecarEvidence = new Map();
      this._metadata = clone(options.metadata || {});
      this._restricted = (options.restrictedEvidenceInfo || []).map(r => ({ id: String(r.id), title: String(r.title || '접근 제한 자료'), accessScope: 'restricted', available: false }));
      this._maps = Object.fromEntries(arrays.map(k => [k, new Map([...(this._bundle[k] || []), ...(this._project[k] || [])].map(x => [x.id, x]))]));
    }
    _assert(snapshotId) { if (snapshotId != null && snapshotId !== this._bundle.snapshotId) throw new RepositoryError('SNAPSHOT_MISMATCH', 'This request belongs to a different snapshot'); }
    async getManifest() { const { schemaVersion, snapshotId, dataMode, generatedAt, status, coverage } = this._bundle; return clone({ schemaVersion, snapshotId, dataMode, generatedAt, status, coverage }); }
    async getDataStatus() {
      return { ...(await this.getManifest()), counts: { properties: this._bundle.properties.length, listings: this._bundle.listings.length, transactions: this._metadata.transactionSummary?.transactions ?? this._transactions.length },
        dates: { generatedAt: this._bundle.generatedAt, sourceCollectedAt: this._metadata.sourceCollectedAt || null, observedThrough: this._metadata.observedThrough || null },
        transactionSummary: clone(this._metadata.transactionSummary || null),
        capabilities: { readOnly: true, adminWrites: false, aiConfigured: false, routeProviderConfigured: false } };
    }
    async listProperties(query = {}) {
      this._assert(query.snapshotId);
      const filters = { regionCodes: [...(query.regionCodes || [])].sort(), types: [...(query.types || [])].sort() };
      let offset = 0;
      if (query.cursor) {
        try { const c = JSON.parse(decodeURIComponent(query.cursor)); if (c.s !== this._bundle.snapshotId || JSON.stringify(c.f) !== JSON.stringify(filters) || !Number.isSafeInteger(c.o) || c.o < 0) throw 0; offset = c.o; }
        catch (_) { throw new RepositoryError('INVALID_CURSOR', 'Cursor must match the snapshot and filters'); }
      }
      const pageSize = query.pageSize == null ? 40 : query.pageSize;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new RepositoryError('INVALID_PAGE_SIZE', 'pageSize must be between 1 and 500');
      const filtered = this._bundle.properties.filter(p => (!filters.regionCodes.length || filters.regionCodes.includes(p.regionCode)) && (!filters.types.length || filters.types.includes(p.propertyType)));
      const data = filtered.slice(offset, offset + pageSize), end = offset + data.length;
      return { data: clone(data), nextCursor: end < filtered.length ? encodeURIComponent(JSON.stringify({ s: this._bundle.snapshotId, f: filters, o: end })) : null, snapshotId: this._bundle.snapshotId };
    }
    async _get(key, id, snapshotId) { this._assert(snapshotId); return clone(this._maps[key].get(id) || null); }
    getProperty(id, sid) { return this._get('properties', id, sid); }
    getClaim(id, sid) { return this._get('claims', id, sid); }
    async getEvidence(id, sid) { this._assert(sid); return clone(this._maps.evidence.get(id) || this._sidecarEvidence.get(id) || null); }
    getProject(id, sid) { return this._get('projects', id, sid); }
    async getListings(id, sid) {
      this._assert(sid);
      return clone(this._bundle.listings.filter(x => x.propertyId === id).map(x => x.saleStatus === 'confirmed_available' && (!x.expiresAt || Date.parse(x.expiresAt) <= this._now()) ? { ...x, saleStatus: 'stale' } : x));
    }
    async getTransactions(id, sid) { this._assert(sid); const context = await this._context(id, sid); return clone([...this._transactions.filter(x => x.propertyId === id), ...(context && context.transactions || [])]); }
    async getProjectEvents(id, sid) { this._assert(sid); return clone(this._project.events.filter(x => x.projectId === id)); }
    async getProjectPlans(id, sid) { this._assert(sid); return clone(this._project.plans.filter(x => x.projectId === id)); }
    async getMembershipLinks(id, sid) { this._assert(sid); return clone(this._project.membershipLinks.filter(x => x.propertyId === id)); }
    async getRestrictedEvidenceInfo(id, sid) { this._assert(sid); return clone(this._restricted.find(x => x.id === id) || null); }
    async _context(id, sid) {
      this._assert(sid);
      if (!this._maps.properties.has(id)) return null;
      if (own(this._legacy, id)) return { legacy: clone(this._legacy[id]) };
      if (!this._contextLoader) return null;
      if (!this._contextCache.has(id)) {
        const pending = Promise.resolve(this._contextLoader(id, this._bundle.snapshotId)).then(context => {
          if (!context) return null;
          const evidence = context.evidence || [], transactions = context.transactions || [], errors = [];
          for (const e of evidence) {
            errors.push(...schemaErrors(e, Schemas.publicBundle.$defs.Evidence, Schemas.publicBundle));
            if (e.isDemo !== (this._bundle.dataMode === 'demo')) errors.push(error('context.evidence', 'data_mode', 'Sidecar evidence mode differs'));
            if (e.url != null && !isSafePublicUrl(e.url)) errors.push(error('context.evidence.url', 'unsafe_url', 'Unsafe source URL'));
            if (e.locator && e.locator.kind === 'structured_record' && !e.locator.recordKey) errors.push(error('context.evidence.locator', 'record_locator', 'Exact record locator is required'));
          }
          errors.push(...checkTransactions(transactions, { ...this._bundle, evidence: [...this._bundle.evidence, ...evidence] }, this._project));
          if (transactions.some(t => t.propertyId !== id)) errors.push(error('context.transactions', 'property_identity', 'Sidecar transaction belongs to another property'));
          if (errors.length) throw new RepositoryError('VALIDATION', 'Property context validation failed', errors);
          for (const e of evidence) this._sidecarEvidence.set(e.id, clone(e));
          return { legacy: context.legacy ? safeLegacy(context.legacy) : null, evidence: clone(evidence), transactions: clone(transactions), limitations: (context.limitations || []).filter(x => typeof x === 'string'), identity: clone(context.identity || null), coverage: clone(context.coverage || null) };
        }).catch(e => { this._contextCache.delete(id); throw e; });
        this._contextCache.set(id, pending);
      }
      return clone(await this._contextCache.get(id));
    }
    async getLegacy(id, sid) { const context = await this._context(id, sid); return context && context.legacy || null; }
    async getPropertyContext(id, sid) {
      const property = await this.getProperty(id, sid); if (!property) return null;
      const sidecar = await this._context(id, sid), legacy = sidecar && sidecar.legacy || null;
      const links = await this.getMembershipLinks(id, sid);
      const projectIds = new Set([...property.projectIds, ...links.map(x => x.projectId)]);
      const projects = [...this._maps.projects.values()].filter(x => projectIds.has(x.id));
      const claims = [...this._maps.claims.values()].filter(x => x.subjectId === id || projectIds.has(x.subjectId));
      const evidenceIds = new Set(claims.flatMap(x => x.evidence.map(e => e.evidenceId)));
      const listings = await this.getListings(id, sid), transactions = await this.getTransactions(id, sid);
      for (const record of [...listings, ...transactions, ...links]) for (const eid of record.evidenceIds) evidenceIds.add(eid);
      return { property, claims: clone(claims), evidence: clone([...this._maps.evidence.values(), ...this._sidecarEvidence.values()].filter(x => evidenceIds.has(x.id))),
        transactions, listings, projects: clone(projects), events: clone(this._project.events.filter(x => projectIds.has(x.projectId))),
        plans: clone(this._project.plans.filter(x => projectIds.has(x.projectId))), membershipLinks: links, legacy,
        dates: { generatedAt: this._bundle.generatedAt, sourceCollectedAt: legacy && legacy.source_collected_at || null, observedThrough: legacy && legacy.transaction_date || null },
        limitations: clone(sidecar && sidecar.limitations || []), transactionCoverage: clone(sidecar && sidecar.coverage || null), identity: clone(sidecar && sidecar.identity || null) };
    }
    getContext(id, sid) { return this.getPropertyContext(id, sid); }
    static async load(options = {}) {
      const mode = options.mode || 'demo';
      if (!['demo', 'live'].includes(mode)) throw new RepositoryError('DATA_MODE', 'Expected demo or live data mode');
      const fetcher = options.fetch || globalThis.fetch;
      if (!fetcher) throw new RepositoryError('FETCH_UNAVAILABLE', 'A fetch implementation is required');
      const base = (options.baseUrl || 'workspace-data/').replace(/\/?$/, '/');
      const read = async path => { const r = await fetcher(base + path, { cache: 'no-cache' }); if (!r.ok) throw new RepositoryError('LOAD_FAILED', 'Snapshot resource unavailable (HTTP ' + r.status + ')'); return r.json(); };
      const [bundle, projectBundle] = await Promise.all([read(mode + '_public_bundle.json'), read(mode + '_project_bundle.json')]);
      if (bundle.dataMode !== mode || projectBundle.dataMode !== mode) throw new RepositoryError('DATA_MODE', 'Requested mode differs from loaded snapshot');
      let contextLoader = null, metadata = {};
      if (mode === 'live') {
        const index = await read('live_context_index.json');
        if (index.snapshotId !== bundle.snapshotId) throw new RepositoryError('SNAPSHOT_MISMATCH', 'Context index snapshot differs');
        metadata = { sourceCollectedAt: index.sourceCollectedAt || null, observedThrough: index.observedThrough || null, transactionSummary: index.transactionSummary || null };
        const cache = new Map(); let catalogPromise = null;
        contextLoader = async id => {
          const path = index.properties[id]; if (!path) return null;
          if (!/^contexts\/[a-zA-Z0-9_-]+\.json$/.test(path)) throw new RepositoryError('UNSAFE_PATH', 'Context must be a local static shard');
          if (!cache.has(path)) cache.set(path, read(path).then(shard => { if (shard.snapshotId !== bundle.snapshotId) throw new RepositoryError('SNAPSHOT_MISMATCH', 'Context shard snapshot differs'); return shard; }).catch(e => { cache.delete(path); throw e; }));
          const shard = await cache.get(path), context = unpackContext(shard.properties[id], shard, id);
          if (context && index.catalogPath) {
            if (index.catalogPath !== 'live_legacy_catalog.json') throw new RepositoryError('UNSAFE_PATH', 'Unexpected catalog path');
            if (!catalogPromise) catalogPromise = read(index.catalogPath).then(c => { if (c.snapshotId !== bundle.snapshotId) throw new RepositoryError('SNAPSHOT_MISMATCH', 'Catalog snapshot differs'); return c; }).catch(e => { catalogPromise = null; throw e; });
            const catalog = await catalogPromise;
            return { ...context, legacy: context.legacy ? hydrateLegacy(context.legacy, catalog.investmentCatalog) : null };
          }
          return context ? { ...context, legacy: context.legacy ? hydrateLegacy(context.legacy, shard.investmentCatalog) : null } : null;
        };
      }
      return new SnapshotRepository(bundle, { projectBundle, contextLoader, metadata, now: options.now });
    }
  }
  // Aggregate medians remain unverified references. This adapter never fabricates a transaction or an active listing.
  function fromLegacy(legacy, options = {}) {
    const generatedAt = options.generatedAt || legacy.generated_at;
    const snapshotId = options.snapshotId || 'legacy-' + (legacy.analysis_as_of || legacy.as_of || 'unknown');
    const items = legacy.items || [], requested = [...new Set(items.map(x => String(x.sgg || x.region || 'unknown')))];
    const bundle = { schemaVersion: '1.0', snapshotId, dataMode: 'live', generatedAt, status: 'partial', coverage: { requested, available: requested.slice(), missing: [] }, properties: [], listings: [], claims: [], evidence: [] };
    const contexts = {};
    for (const item of items) {
      const id = String(item.id), claimId = 'legacy-price:' + id;
      const date = item.transaction_date || legacy.analysis_as_of || legacy.as_of;
      const price = Number.isSafeInteger(item.price) && item.price >= 0 && dateOK(date || '') ? String(item.price) : null;
      if (price != null) bundle.claims.push({ id: claimId, isDemo: false, subjectId: id, predicate: 'legacy_reference_price', value: price, unit: 'KRW', state: 'unverified', evidence: [], assumptionIds: [], calculationId: null, validFrom: date, validTo: null, limitation: '기존 거래 요약값입니다. 개별 계약 원문과 산식이 이 계약에 연결되지 않아 미확인 참고값으로 유지합니다.' });
      const sqm = Number(item.area), lat = item.lat, lon = item.lon;
      const villa = ['rh', 'villa', '빌라', '연립다세대'].includes(item.kind);
      bundle.properties.push({ id, isDemo: false, name: item.apt || item.name || id, granularity: villa ? 'building' : 'complex', propertyType: villa ? 'villa' : 'apartment', regionCode: String(item.lawd_cd || item.sgg || item.region || 'unknown'), addressLabel: [item.region, item.dong, item.apt].filter(Boolean).join(' ') || null, parcelIds: [], buildingIds: [], area: Number.isFinite(sqm) && sqm > 0 ? { sqm, basis: 'exclusive' } : null, location: typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon } : null, currentPrice: price == null ? null : { amountKrw: price, kind: 'reference_range', asOf: date, claimId }, listingIds: [], projectIds: [], claimIds: price == null ? [] : [claimId] });
      contexts[id] = safeLegacy(hydrateLegacy(item, legacy.investment_catalog));
    }
    return new SnapshotRepository(bundle, { legacyContexts: contexts, projectBundle: emptyProject(bundle) });
  }
  return { SnapshotRepository, fromLegacy, validatePublicBundle, validateProjectBundle, RepositoryError, isSafePublicUrl, schemaErrors };
});
