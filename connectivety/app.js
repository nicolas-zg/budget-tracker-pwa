const STATIONS = [
  { id: 'ch:1:sloid:3000', name: 'Zürich HB' },
  { id: 'ch:1:sloid:3003', name: 'Zürich Stadelhofen' },
  { id: 'ch:1:sloid:3006', name: 'Zürich Oerlikon' },
  { id: 'ch:1:sloid:3010', name: 'Zürich Enge' },
  { id: 'ch:1:sloid:3011', name: 'Zürich Wiedikon' },
  { id: 'ch:1:sloid:3001', name: 'Zürich Altstetten' },
];

const ACCESS = {
  'PLATFORM_ACCESS_WITHOUT_ASSISTANCE':             { icon: '✓', label: 'Barrierefrei',       cls: 'access-ok' },
  'PLATFORM_ACCESS_WITH_ASSISTANCE_WHEN_NOTIFIED':  { icon: '⚠', label: 'Mit Voranmeldung',   cls: 'access-warn' },
  'PLATFORM_NOT_WHEELCHAIR_ACCESSIBLE':             { icon: '✗', label: 'Nicht zugänglich',   cls: 'access-err' },
};

// ─── Logging ───────────────────────────────────────────────────────────────

let rawEntries = [];

function log(label, data) {
  rawEntries.push({ ts: new Date().toISOString(), label, data });
  const pre = document.getElementById('raw-log');
  pre.textContent = rawEntries.map(e => {
    const body = typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2);
    return `=== ${e.ts}  ${e.label} ===\n${body}`;
  }).join('\n\n');
  document.getElementById('log-count').textContent = `(${rawEntries.length})`;
  document.getElementById('log-wrap').style.display = 'block';
  document.getElementById('raw-log').style.display = 'block';
}

function toggleLog() {
  const pre = document.getElementById('raw-log');
  const btn = document.getElementById('log-toggle-btn');
  const open = pre.style.display !== 'none';
  pre.style.display = open ? 'none' : 'block';
  btn.classList.toggle('collapsed', open);
  document.getElementById('log-label').textContent = (open ? '▶' : '▼') + ' API Rohlog';
}

// ─── XML helpers (namespace-agnostic via localName) ────────────────────────

function $$(root, localName) {
  return Array.from(root.getElementsByTagName('*')).filter(e => e.localName === localName);
}
function $1(root, localName) { return $$(root, localName)[0] || null; }
function txt(root, localName) {
  const el = $1(root, localName);
  return el ? el.textContent.trim() : '';
}
// Gets direct Text child of a named element (avoids bleeding into nested elements)
function directText(parent, childName) {
  const child = $1(parent, childName);
  if (!child) return '';
  const textEl = $1(child, 'Text');
  return textEl ? textEl.textContent.trim() : child.textContent.trim();
}

// ─── OJP 2.0 request builder ───────────────────────────────────────────────
// OJP 2.0 uses OJP elements as default namespace; SIRI elements use siri: prefix.
// This is reversed from OJP 1.0.

function buildOJPRequest(from, to, depTime) {
  const ts = depTime.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp"
     xmlns:siri="http://www.siri.org.uk/siri"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     Version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${ts}</siri:RequestTimestamp>
      <siri:RequestorRef>barrier-free-spike</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${ts}</siri:RequestTimestamp>
        <Origin>
          <PlaceRef>
            <siri:StopPointRef>${from.id}</siri:StopPointRef>
            <LocationName><Text>${from.name}</Text></LocationName>
          </PlaceRef>
          <DepArrTime>${ts}</DepArrTime>
        </Origin>
        <Destination>
          <PlaceRef>
            <siri:StopPointRef>${to.id}</siri:StopPointRef>
            <LocationName><Text>${to.name}</Text></LocationName>
          </PlaceRef>
        </Destination>
        <Params>
          <NumberOfResults>5</NumberOfResults>
          <IncludeTrackSections>false</IncludeTrackSections>
          <IncludeIntermediateStops>true</IncludeIntermediateStops>
        </Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

// ─── API calls ─────────────────────────────────────────────────────────────

async function callOJP(xml) {
  log('OJP REQUEST', xml);
  const res = await fetch('/proxy/ojp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  const text = await res.text();
  log(`OJP RESPONSE (HTTP ${res.status})`, text);
  if (!res.ok) throw new Error(`OJP HTTP ${res.status} – see raw log`);
  return text;
}

async function fetchPRM() {
  // H1 finding: aufzugzustand (real-time lift status) no longer exists on data.sbb.ch.
  // Using prm_stop_places (static BehiG accessibility data, sloid-keyed) for H2 combinability test.
  log('PRM REQUEST (H2 test – prm_stop_places via data.sbb.ch)', '/proxy/prm');
  try {
    const res = await fetch('/proxy/prm');
    const json = await res.json();
    const records = json.results || [];
    log(`PRM RESPONSE (${records.length} records, total=${json.total_count})`, json);
    if (records.length > 0) {
      log('PRM FIELDS (H2 schema – first record)', records[0]);
    }
    return records;
  } catch (err) {
    log('PRM FETCH FAILED', err.message);
    return [];
  }
}

// ─── OJP response parser ───────────────────────────────────────────────────

function parseSituations(doc) {
  // Extract disruption texts from TripResponseContext > Situations
  const situations = {};
  $$(doc, 'PtSituation').forEach(sit => {
    const id = txt(sit, 'SituationNumber');
    const summary = txt(sit, 'SummaryText');
    const reason  = txt(sit, 'ReasonText');
    const desc    = txt(sit, 'DescriptionText');
    const rec     = txt(sit, 'RecommendationText');
    if (id) situations[id] = { summary, reason, desc, rec };
  });
  return situations;
}

function parseAccessCode(nameSuffix) {
  const val = (nameSuffix || '').toUpperCase().trim();
  return ACCESS[val] || null;
}

function parseLegBoard(timedLeg) {
  const el = $1(timedLeg, 'LegBoard');
  if (!el) return null;
  const stopRef   = txt(el, 'StopPointRef');
  const stopName  = directText(el, 'StopPointName');
  const access    = parseAccessCode(directText(el, 'NameSuffix'));
  const quay      = directText(el, 'PlannedQuay');
  const depEl     = $1(el, 'ServiceDeparture');
  const time      = depEl ? (txt(depEl, 'EstimatedTime') || txt(depEl, 'TimetabledTime')) : '';
  return { stopRef, stopName, access, quay, time };
}

function parseLegAlight(timedLeg) {
  const el = $1(timedLeg, 'LegAlight');
  if (!el) return null;
  const stopRef   = txt(el, 'StopPointRef');
  const stopName  = directText(el, 'StopPointName');
  const access    = parseAccessCode(directText(el, 'NameSuffix'));
  const quay      = directText(el, 'PlannedQuay');
  const arrEl     = $1(el, 'ServiceArrival');
  const time      = arrEl ? (txt(arrEl, 'EstimatedTime') || txt(arrEl, 'TimetabledTime')) : '';
  return { stopRef, stopName, access, quay, time };
}

function parseTrips(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  const parseErr = $1(doc, 'parsererror');
  if (parseErr) { log('XML PARSE ERROR', parseErr.textContent); return { trips: [], situations: {} }; }

  const statusEl = $1(doc, 'Status');
  if (statusEl && statusEl.textContent.trim() === 'false') {
    log('OJP STATUS FALSE', txt(doc, 'Description') || '(see raw log)');
  }

  const situations = parseSituations(doc);

  // Debug: log what the parser actually sees
  const allLocalNames = Array.from(doc.getElementsByTagName('*')).map(e => e.localName);
  const tripResultCount = allLocalNames.filter(n => n === 'TripResult').length;
  const legCount = allLocalNames.filter(n => n === 'Leg').length;
  log('PARSE DEBUG', { tripResultCount, legCount, xmlLength: xmlText.length, first200: xmlText.slice(0, 200) });

  const trips = $$(doc, 'TripResult').map(tr => {
    // OJP 2.0: TripResult > Trip > Leg (not TripLeg)
    const legs = $$(tr, 'Leg').map(legEl => {
      const timedEl    = $1(legEl, 'TimedLeg');
      const transferEl = $1(legEl, 'TransferLeg');

      if (timedEl) {
        const board  = parseLegBoard(timedEl);
        const alight = parseLegAlight(timedEl);
        const svc    = $1(timedEl, 'Service');

        // Line name: prefer PublishedServiceName, fall back to PublicCode
        const line = svc ? (directText(svc, 'PublishedServiceName') || txt(svc, 'PublicCode')) : '?';
        const mode = svc ? txt($1(svc, 'Mode') || svc, 'PtMode') : '';

        // Train attributes (Niederflureinstieg, etc.)
        const attrs = svc ? $$(svc, 'Attribute').map(a => txt(a, 'UserText')).filter(Boolean) : [];

        // Situations affecting this leg
        const sitRefs = svc ? $$(svc, 'SituationFullRef').map(r => txt(r, 'SituationNumber')) : [];
        const legSituations = sitRefs.map(id => situations[id]).filter(Boolean);

        return { type: 'transit', board, alight, line, mode, attrs, legSituations };
      }

      if (transferEl) {
        const fromEl = $1(transferEl, 'LegStart');
        const toEl   = $1(transferEl, 'LegEnd');
        return {
          type: 'walk',
          fromName: fromEl ? (directText(fromEl, 'LocationName') || txt(fromEl, 'StopPointName')) : '',
          toName:   toEl   ? (directText(toEl,   'LocationName') || txt(toEl,   'StopPointName')) : '',
          dur: txt(transferEl, 'Duration'),
        };
      }

      return null;
    }).filter(Boolean);

    const transit = legs.filter(l => l.type === 'transit');
    const transfers = transit.slice(0, -1).map((leg, i) => {
      const next = transit[i + 1];
      const arrTime = leg.alight?.time;
      const depTime = next.board?.time;
      const minutes = (arrTime && depTime)
        ? Math.round((new Date(depTime) - new Date(arrTime)) / 60000)
        : null;
      return {
        stopName: leg.alight?.stopName || '',
        arrTime, depTime, minutes,
      };
    });

    const dep = transit[0]?.board?.time;
    const arr = transit[transit.length - 1]?.alight?.time;
    let duration = '';
    if (dep && arr) {
      const m = Math.round((new Date(arr) - new Date(dep)) / 60000);
      duration = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}min` : `${m} min`;
    }

    return { legs, transit, transfers, dep, arr, duration };
  });

  return { trips, situations };
}

// ─── PRM matching (H2 test) ────────────────────────────────────────────────
// prm_stop_places uses sloid directly matching OJP stop refs — no ID mapping needed.
// Extract station part from platform sloid: ch:1:sloid:3000:3:5 → ch:1:sloid:3000

function stationSloid(sloid) {
  return (sloid || '').split(':').slice(0, 4).join(':');
}

function matchPRM(stopSloid, prmRecords) {
  if (!prmRecords.length) return { status: 'no-data', matched: [] };

  const stationId = stationSloid(stopSloid);
  if (!stationId) return { status: 'no-data', matched: [] };

  const matched = prmRecords.filter(r => stationSloid(r.sloid) === stationId);
  if (!matched.length) return { status: 'no-data', matched: [] };

  // vehicleaccess can be: PLATFORM_ACCESS_WITHOUT_ASSISTANCE,
  // PLATFORM_ACCESS_WITH_ASSISTANCE, PLATFORM_NOT_WHEELCHAIR_ACCESSIBLE, etc.
  const hasNotAccessible = matched.some(r =>
    r.vehicleaccess === 'PLATFORM_NOT_WHEELCHAIR_ACCESSIBLE' ||
    r.levelaccesswheelchair === 'NO'
  );
  const hasAssistanceOnly = matched.some(r =>
    r.vehicleaccess === 'PLATFORM_ACCESS_WITH_ASSISTANCE' ||
    r.vehicleaccess === 'PLATFORM_ACCESS_WITH_ASSISTANCE_WHEN_NOTIFIED'
  );

  const status = hasNotAccessible ? 'not-accessible'
    : hasAssistanceOnly ? 'assistance'
    : 'ok';

  return { status, matched };
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function fmtDuration(iso) {
  if (!iso) return '';
  const h = iso.match(/(\d+)H/)?.[1];
  const m = iso.match(/(\d+)M/)?.[1];
  if (h && m) return `${h}h ${m} min`;
  if (h)      return `${h}h`;
  if (m)      return `${m} min`;
  return iso;
}

function fmtTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('de-CH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
  });
}

function accessTag(access) {
  if (!access) return '';
  return `<span class="elev-tag ${access.cls}">${access.icon} ${access.label}</span>`;
}

function renderResults(trips, situations, prmRecords, filterFailed = false) {
  const el = document.getElementById('results');

  if (!trips.length) {
    el.innerHTML = '<div class="error-box">Keine Verbindungen gefunden. Details im Rohlog unten.</div>';
    el.style.display = 'block';
    return;
  }

  let html = filterFailed
    ? '<div class="error-box" style="background:#fff3e0;border-color:#ffe082;color:#555">Keine Verbindung mit ≥5 Min. Umsteigezeit gefunden – zeige alle Verbindungen.</div>'
    : '';

  trips.forEach(trip => {
    const allLegs = trip.transit;

    // Trip-level accessibility: worst access across all board/alight points
    const accessCodes = allLegs.flatMap(l => [l.board?.access, l.alight?.access].filter(Boolean));
    const hasNotAccessible = accessCodes.some(a => a.cls === 'access-err');
    const hasAssistance    = accessCodes.some(a => a.cls === 'access-warn');
    const allSituations    = allLegs.flatMap(l => l.legSituations);
    const hasLiftIssue     = allSituations.some(s => s.reason?.toLowerCase().includes('lift') || s.summary?.toLowerCase().includes('lift'));

    let badge = '';
    if (hasNotAccessible)  badge = `<span class="badge badge-orange">✗ Nicht zugänglich</span>`;
    else if (hasLiftIssue) badge = `<span class="badge badge-orange">⚠ Liftstörung</span>`;
    else if (hasAssistance)badge = `<span class="badge badge-grey">⚠ Mit Voranmeldung</span>`;
    else if (accessCodes.length) badge = `<span class="badge badge-green">✓ Barrierefrei</span>`;
    else badge = `<span class="badge badge-grey">? Keine Daten</span>`;

    html += `
<div class="trip-card">
  <div class="trip-header">
    <div>
      <div class="trip-times">${fmtTime(trip.dep)} → ${fmtTime(trip.arr)}</div>
      <div class="trip-dur">${trip.duration} · ${allLegs.length} Abschnitt${allLegs.length !== 1 ? 'e' : ''}</div>
    </div>
    ${badge}
  </div>`;

    // Show disruption alerts at top of card
    const uniqueSituations = [...new Map(allSituations.map(s => [s.summary, s])).values()];
    uniqueSituations.forEach(s => {
      html += `<div class="situation-box">
  <strong>${s.summary}</strong>
  ${s.reason ? `<div class="situation-detail">${s.reason}</div>` : ''}
  ${s.desc    ? `<div class="situation-detail">${s.desc}</div>` : ''}
</div>`;
    });

    trip.legs.forEach(leg => {
      if (leg.type === 'transit') {
        const modeIcon = leg.mode === 'tram' ? '🚃' : leg.mode === 'bus' ? '🚌' : '🚆';
        const lowFloor = leg.attrs.some(a => a.toLowerCase().includes('niederflur') && !a.toLowerCase().includes('kein'));
        const noFloor  = leg.attrs.some(a => a.toLowerCase().includes('kein niederflur'));

        html += `
  <div class="leg">
    <div class="leg-icon">${modeIcon}</div>
    <div class="leg-info">
      <div class="leg-line">${leg.line}${lowFloor ? ' <span class="attr-tag">NF</span>' : ''}${noFloor ? ' <span class="attr-tag attr-warn">Kein NF</span>' : ''}</div>
      <div class="leg-stops">
        ${leg.board?.stopName || '–'} ${fmtTime(leg.board?.time)}${leg.board?.quay ? ` Gl. ${leg.board.quay}` : ''}
        ${leg.board?.access ? `<br>${accessTag(leg.board.access)}` : ''}
      </div>
      <div class="leg-stops" style="margin-top:4px">
        ${leg.alight?.stopName || '–'} ${fmtTime(leg.alight?.time)}${leg.alight?.quay ? ` Gl. ${leg.alight.quay}` : ''}
        ${leg.alight?.access ? `<br>${accessTag(leg.alight.access)}` : ''}
      </div>
    </div>
  </div>`;

        // Transfer row after this leg (if not last)
        const tIdx = trip.transit.indexOf(leg);
        if (tIdx >= 0 && tIdx < trip.transfers.length) {
          const t = trip.transfers[tIdx];
          const prmStatus = matchPRM(leg.alight?.stopRef || '', prmRecords);
          let elevHtml = '';
          if (prmStatus.status === 'ok')             elevHtml = `<span class="elev-tag elev-ok">✓ Niveau-Zugang (BehiG)</span>`;
          else if (prmStatus.status === 'assistance') elevHtml = `<span class="elev-tag elev-unknown">⚠ Mit Voranmeldung (BehiG)</span>`;
          else if (prmStatus.status === 'not-accessible') elevHtml = `<span class="elev-tag elev-issue">✗ Nicht zugänglich (BehiG)</span>`;
          else                                           elevHtml = `<span class="elev-tag elev-unknown">? Keine BehiG-Daten</span>`;

          html += `
  <div class="transfer-row">
    <span class="transfer-label">Umstieg in ${t.stopName} · ${t.minutes ?? '?'} Min.</span>
    ${elevHtml}
  </div>`;
        }
      } else {
        html += `
  <div class="leg">
    <div class="leg-icon">🚶</div>
    <div class="leg-info">
      <div class="leg-line" style="font-weight:400">Fussweg${leg.dur ? ' · ' + fmtDuration(leg.dur) : ''}</div>
      ${leg.fromName ? `<div class="leg-stops">${leg.fromName} → ${leg.toName}</div>` : ''}
    </div>
  </div>`;
      }
    });

    html += '</div>';
  });

  el.innerHTML = html;
  el.style.display = 'block';
}

// ─── Main search ───────────────────────────────────────────────────────────

async function search() {
  const fromId = document.getElementById('from').value;
  const toId   = document.getElementById('to').value;
  const more   = document.getElementById('more-time').checked;

  if (!fromId || !toId) { alert('Bitte Start- und Ziel wählen.'); return; }
  if (fromId === toId)  { alert('Start und Ziel müssen verschieden sein.'); return; }

  const from = STATIONS.find(s => s.id === fromId);
  const to   = STATIONS.find(s => s.id === toId);

  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Suche läuft…';

  rawEntries = [];
  document.getElementById('results').style.display = 'none';

  try {
    const xml = buildOJPRequest(from, to, new Date());
    const [ojpResult, prmResult] = await Promise.allSettled([
      callOJP(xml),
      fetchPRM(),
    ]);

    if (ojpResult.status === 'rejected') {
      document.getElementById('results').innerHTML =
        `<div class="error-box">OJP-Fehler: ${ojpResult.reason.message}<br>Details im Rohlog.</div>`;
      document.getElementById('results').style.display = 'block';
      return;
    }

    const prmRecords = prmResult.status === 'fulfilled' ? prmResult.value : [];
    const { trips, situations } = parseTrips(ojpResult.value);

    trips.sort((a, b) => new Date(a.dep) - new Date(b.dep));

    const filtered = more
      ? trips.filter(t => t.transfers.every(x => x.minutes !== null && x.minutes >= 5))
      : trips;
    const filterFailed = more && filtered.length === 0;
    const displayTrips = filterFailed ? trips : filtered;

    log('PARSED TRIPS', trips);
    renderResults(displayTrips, situations, prmRecords, filterFailed);

  } catch (err) {
    document.getElementById('results').innerHTML =
      `<div class="error-box">Unerwarteter Fehler: ${err.message}</div>`;
    document.getElementById('results').style.display = 'block';
    log('UNCAUGHT ERROR', err.stack || err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verbindung suchen';
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const fromSel = document.getElementById('from');
  const toSel   = document.getElementById('to');
  STATIONS.forEach(s => {
    const opt = `<option value="${s.id}">${s.name}</option>`;
    fromSel.insertAdjacentHTML('beforeend', opt);
    toSel.insertAdjacentHTML('beforeend', opt);
  });
});
