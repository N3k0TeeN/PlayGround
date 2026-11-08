(() => {
  'use strict';
  const SIZE = 10;
  const LETTERS = 'ABCDEFGHIJ'.split('');
  const FLEET = [
    { id: 'carrier', name: 'Carrier', size: 5, type: 'CV-05' },
    { id: 'battleship', name: 'Battleship', size: 4, type: 'BB-04' },
    { id: 'cruiser', name: 'Cruiser', size: 3, type: 'CR-03' },
    { id: 'submarine', name: 'Submarine', size: 3, type: 'SS-03' },
    { id: 'destroyer', name: 'Destroyer', size: 2, type: 'DD-02' }
  ];
  const $ = id => document.getElementById(id);
  const playerGrid = $('playerGrid');
  const enemyGrid = $('enemyGrid');
  let phase = 'placement';
  let orientation = 'horizontal';
  let selectedShip = FLEET[0].id;
  let playerShips = [];
  let enemyShips = [];
  let playerShots = new Set();
  let enemyShots = new Set();
  let playerHits = new Set();
  let enemyHits = new Set();
  let logs = [];
  let busy = false;
  let soundOn = true;
  let audioContext = null;
  let toastTimer;

  const keyOf = (r, c) => `${r},${c}`;
  const coord = (r, c) => `${LETTERS[c]}${r + 1}`;
  const shipAt = (ships, r, c) => ships.find(ship => ship.cells.some(cell => cell.r === r && cell.c === c));
  const isSunk = (ship, shots) => ship.cells.every(cell => shots.has(keyOf(cell.r, cell.c)));
  const afloat = (ships, shots) => ships.filter(ship => !isSunk(ship, shots)).length;

  function makeBoard(container, isEnemy) {
    container.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('role', 'gridcell');
        if (isEnemy) {
          cell.setAttribute('aria-label', `Enemy waters ${coord(r, c)}; fire here`);
          cell.addEventListener('mouseenter', () => $('enemyReadout').textContent = `RADAR // ${coord(r, c)}`);
          cell.addEventListener('focus', () => $('enemyReadout').textContent = `RADAR // ${coord(r, c)}`);
          cell.addEventListener('click', () => fireAt(r, c));
        } else {
          cell.setAttribute('aria-label', `Your waters ${coord(r, c)}`);
          cell.addEventListener('mouseenter', () => $('playerReadout').textContent = `GRID // ${coord(r, c)}`);
          cell.addEventListener('focus', () => $('playerReadout').textContent = `GRID // ${coord(r, c)}`);
          cell.addEventListener('click', () => placeSelected(r, c));
        }
        container.appendChild(cell);
      }
    }
  }
  function updateAxes() {
    ['player', 'enemy'].forEach(prefix => {
      $(prefix + 'Letters').innerHTML = LETTERS.map(x => `<span>${x}</span>`).join('');
      $(prefix + 'Numbers').innerHTML = Array.from({ length: SIZE }, (_, i) => `<span>${i + 1}</span>`).join('');
    });
  }
  function cellElement(container, r, c) { return container.children[r * SIZE + c]; }

  function render() {
    makeBoard(playerGrid, false);
    makeBoard(enemyGrid, true);
    renderPlayerBoard();
    renderEnemyBoard();
    renderFleetList();
    $('playerFleetCount').textContent = phase === 'placement' ? playerShips.length : afloat(playerShips, enemyShots);
    $('enemyFleetCount').textContent = phase === 'placement' ? '5' : afloat(enemyShips, playerShots);
    $('roundLabel').textContent = phase === 'placement' ? 'PREP PHASE' : phase === 'battle' ? 'COMBAT // LIVE' : 'MISSION COMPLETE';
    const active = phase === 'battle' && !busy;
    enemyGrid.classList.toggle('can-fire', active);
    enemyGrid.classList.toggle('grid-disabled', !active);
    $('deployControls').classList.toggle('hidden', phase !== 'placement');
    $('combatControls').classList.toggle('hidden', phase === 'placement');
    $('launchButton').disabled = playerShips.length !== FLEET.length;
    $('launchButton').textContent = playerShips.length === FLEET.length ? 'DEPLOY FLEET   →' : `DEPLOY FLEET  ${playerShips.length}/${FLEET.length}`;
    $('rotateButton').innerHTML = `<span class="rotate-icon">↻</span> ${orientation.toUpperCase()} <kbd>R</kbd>`;
    $('turnPill').classList.toggle('enemy-turn', busy);
    if (phase === 'placement') {
      $('turnText').textContent = 'FLEET SETUP';
      $('boardSubheading').textContent = playerShips.length === FLEET.length ? 'Your fleet is ready. Engage when you are.' : `Place the ${shipName(selectedShip)} — tap a starting square.`;
      $('playerBoardStatus').textContent = playerShips.length === 0 ? 'AWAITING DEPLOYMENT' : `${playerShips.length} / 5 DEPLOYED`;
      $('enemyBoardStatus').textContent = 'SCANNING...';
      $('radarLight').classList.remove('active');
      $('objectiveTitle').textContent = playerShips.length === FLEET.length ? 'Fleet deployed' : 'Deploy your fleet';
      $('objectiveText').textContent = playerShips.length === FLEET.length ? 'All five vessels are in position. Launch when ready to begin the engagement.' : `Place all five vessels in the grid. ${shipName(selectedShip)} spans ${shipLength(selectedShip)} squares ${orientation}.`;
      $('introCopy').textContent = 'Deploy your fleet. Find their signal. Sink every ship.';
    } else {
      $('turnText').textContent = phase === 'over' ? 'MISSION COMPLETE' : busy ? 'ENEMY TURN' : 'YOUR TURN';
      $('boardSubheading').textContent = phase === 'over' ? 'Engagement concluded.' : busy ? 'Incoming transmission — enemy firing.' : 'Tap an enemy square to launch a strike.';
      $('playerBoardStatus').textContent = `${afloat(playerShips, enemyShots)} VESSELS ACTIVE`;
      $('enemyBoardStatus').textContent = phase === 'over' ? 'SIGNAL TERMINATED' : busy ? 'INCOMING STRIKE' : 'TARGET LOCK // READY';
      $('radarLight').classList.add('active');
      $('objectiveTitle').textContent = phase === 'over' ? (afloat(enemyShips, playerShots) === 0 ? 'Victory — signal silenced' : 'Defeat — fleet lost') : 'Sink the enemy fleet';
      $('objectiveText').textContent = phase === 'over' ? (afloat(enemyShips, playerShots) === 0 ? 'All hostile vessels have been neutralized. Well commanded, Captain.' : 'Your fleet has been sunk. Regroup and try another approach.') : 'Find and sink all five hostile vessels. Hits glow orange; misses leave a signal trace.';
      $('introCopy').textContent = phase === 'over' ? (afloat(enemyShips, playerShots) === 0 ? 'Enemy signal lost. The waters are yours.' : 'Your signal has gone dark. The battle is over.') : 'Your fleet is live. Make every signal count.';
    }
    if (phase === 'over') $('turnPill').classList.toggle('enemy-turn', afloat(enemyShips, playerShots) > 0);
  }
  function shipName(id) { return (FLEET.find(ship => ship.id === id) || FLEET[0]).name; }
  function shipLength(id) { return (FLEET.find(ship => ship.id === id) || FLEET[0]).size; }

  function renderPlayerBoard() {
    const hitsOnUs = enemyShots;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const el = cellElement(playerGrid, r, c);
      const ship = shipAt(playerShips, r, c);
      const k = keyOf(r, c);
      el.className = 'cell';
      if (ship) {
        el.classList.add('ship-cell');
        el.setAttribute('aria-label', `Your ${ship.name} at ${coord(r, c)}${hitsOnUs.has(k) ? ', hit' : ''}`);
      }
      if (hitsOnUs.has(k)) {
        el.classList.add(ship ? 'ship-hit' : 'miss');
        if (ship) el.classList.add('hit');
      }
      if (phase === 'placement' && ship) el.disabled = true;
    }
  }
  function renderEnemyBoard() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const el = cellElement(enemyGrid, r, c);
      const k = keyOf(r, c);
      el.className = 'cell';
      el.disabled = phase !== 'battle' || busy || playerShots.has(k);
      if (playerShots.has(k)) {
        const ship = shipAt(enemyShips, r, c);
        el.classList.add(ship ? 'hit' : 'miss');
        if (ship && isSunk(ship, playerShots)) el.classList.add('sunk-cell');
        el.setAttribute('aria-label', `Enemy waters ${coord(r, c)}: ${ship ? 'hit' : 'miss'}${ship && isSunk(ship, playerShots) ? ', ship sunk' : ''}`);
      }
    }
  }
  function renderFleetList() {
    const list = $('fleetList');
    list.innerHTML = '';
    FLEET.forEach(ship => {
      const placed = playerShips.some(item => item.id === ship.id);
      const row = document.createElement('div');
      row.className = `fleet-row${selectedShip === ship.id && phase === 'placement' && !placed ? ' selected' : ''}${placed ? ' done' : ''}`;
      row.innerHTML = `<span class="ship-glyph" aria-hidden="true">${Array.from({ length: ship.size }, () => '<i></i>').join('')}</span><strong>${ship.name}</strong><small>${ship.type}</small><span class="fleet-state">${placed ? 'READY' : selectedShip === ship.id && phase === 'placement' ? 'PLACE' : `${ship.size} CELLS`}</span>`;
      if (!placed && phase === 'placement') {
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `Select ${ship.name}, ${ship.size} cells`);
        row.addEventListener('click', () => { selectedShip = ship.id; render(); });
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedShip = ship.id; render(); } });
      }
      list.appendChild(row);
    });
  }

  function cellsFor(r, c, direction, length) {
    return Array.from({ length }, (_, i) => ({ r: r + (direction === 'vertical' ? i : 0), c: c + (direction === 'horizontal' ? i : 0) }));
  }
  function validPlacement(cells, ships) {
    return cells.every(cell => cell.r >= 0 && cell.r < SIZE && cell.c >= 0 && cell.c < SIZE && !shipAt(ships, cell.r, cell.c));
  }
  function placeSelected(r, c) {
    if (phase !== 'placement' || playerShips.some(ship => ship.id === selectedShip)) return;
    const def = FLEET.find(ship => ship.id === selectedShip);
    const cells = cellsFor(r, c, orientation, def.size);
    if (!validPlacement(cells, playerShips)) {
      showToast('Cannot deploy there — vessel is out of bounds or overlapping.');
      playTone(150, .08, 'square');
      return;
    }
    playerShips.push({ ...def, cells });
    playTone(500, .07);
    addLog(`${def.name} deployed at ${coord(r, c)}.`, 'info');
    const next = FLEET.find(ship => !playerShips.some(placed => placed.id === ship.id));
    selectedShip = next ? next.id : '';
    render();
    if (!next) showToast('Fleet deployed. You are clear to engage.');
  }
  function rotate() {
    if (phase !== 'placement') return;
    orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    render();
    playTone(350, .045);
  }
  function randomFleet() {
    const ships = [];
    for (const def of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 500 && !placed; tries++) {
        const direction = Math.random() < .5 ? 'horizontal' : 'vertical';
        const r = Math.floor(Math.random() * SIZE);
        const c = Math.floor(Math.random() * SIZE);
        const cells = cellsFor(r, c, direction, def.size);
        if (validPlacement(cells, ships)) { ships.push({ ...def, cells }); placed = true; }
      }
    }
    return ships;
  }
  function autoDeploy() {
    if (phase !== 'placement') return;
    playerShips = randomFleet();
    selectedShip = '';
    addLog('Fleet auto-deployed to tactical positions.', 'info');
    render();
    playTone(620, .12);
    showToast('Fleet deployed — all vessels ready.');
  }
  function launch() {
    if (phase !== 'placement' || playerShips.length !== FLEET.length) return;
    enemyShips = randomFleet();
    phase = 'battle';
    selectedShip = '';
    addLog('Encrypted link established. Engagement authorized.', 'info');
    render();
    playTone(660, .1);
    setTimeout(() => playTone(880, .12), 100);
    showToast('Signal acquired. Select a square to fire.');
  }

  function fireAt(r, c) {
    if (phase !== 'battle' || busy) return;
    const k = keyOf(r, c);
    if (playerShots.has(k)) return;
    playerShots.add(k);
    const target = shipAt(enemyShips, r, c);
    if (target) {
      playerHits.add(k);
      if (isSunk(target, playerShots)) {
        addLog(`${target.name} sunk at ${coord(r, c)}.`, 'sunk');
        showToast(`Direct hit — enemy ${target.name} sunk!`);
        playTone(240, .22, 'sawtooth');
      } else {
        addLog(`Direct hit on hostile vessel at ${coord(r, c)}.`, 'hit');
        showToast(`Direct hit at ${coord(r, c)}!`);
        playTone(420, .13, 'sawtooth');
      }
      flashScreen();
    } else {
      addLog(`Strike at ${coord(r, c)} — no contact.`, 'miss');
      playTone(250, .1, 'sine');
    }
    if (afloat(enemyShips, playerShots) === 0) {
      phase = 'over';
      addLog('All hostile vessels neutralized. Victory.', 'info');
      render();
      playTone(660, .12);
      setTimeout(() => playTone(880, .16), 130);
      return;
    }
    busy = true;
    render();
    setTimeout(enemyTurn, 700);
  }
  function enemyTurn() {
    if (phase !== 'battle') return;
    const available = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!enemyShots.has(keyOf(r, c))) available.push({ r, c });
    if (!available.length) return;
    // Follow up on a damaged vessel when an untried orthogonal neighbor exists.
    let choices = [];
    for (const k of enemyHits) {
      const [r, c] = k.split(',').map(Number);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !enemyShots.has(keyOf(nr, nc))) choices.push({ r: nr, c: nc });
      }
    }
    choices = choices.filter((cell, index, arr) => arr.findIndex(other => other.r === cell.r && other.c === cell.c) === index);
    const shot = choices.length ? choices[Math.floor(Math.random() * choices.length)] : available[Math.floor(Math.random() * available.length)];
    const k = keyOf(shot.r, shot.c);
    enemyShots.add(k);
    const target = shipAt(playerShips, shot.r, shot.c);
    if (target) {
      enemyHits.add(k);
      if (isSunk(target, enemyShots)) {
        addLog(`Your ${target.name} lost at ${coord(shot.r, shot.c)}.`, 'sunk');
        showToast(`Your ${target.name} has been sunk.`);
        playTone(185, .2, 'sawtooth');
      } else {
        addLog(`Hostile strike hit your fleet at ${coord(shot.r, shot.c)}.`, 'hit');
        showToast(`Incoming hit at ${coord(shot.r, shot.c)}!`);
        playTone(210, .12, 'square');
      }
      flashScreen();
    } else {
      addLog(`Enemy strike at ${coord(shot.r, shot.c)} — splash.`, 'miss');
      playTone(180, .08, 'sine');
    }
    busy = false;
    if (afloat(playerShips, enemyShots) === 0) {
      phase = 'over';
      addLog('Your fleet has been lost. Signal terminated.', 'hit');
    }
    render();
  }
  function addLog(message, type) {
    logs.unshift({ message, type, time: String(logs.length + 1).padStart(2, '0') });
    logs = logs.slice(0, 12);
    $('logCount').textContent = String(logs.length).padStart(2, '0');
    const log = $('eventLog');
    log.innerHTML = logs.map(item => `<div class="log-entry ${item.type}"><span class="log-time">${item.time}</span><span class="log-message">${escapeHtml(item.message)}</span></div>`).join('');
  }
  function escapeHtml(text) { return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }
  function flashScreen() {
    const flash = $('screenFlash');
    flash.classList.remove('active');
    void flash.offsetWidth;
    flash.classList.add('active');
  }
  function playTone(freq, duration, wave = 'sine') {
    if (!soundOn) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);
      gain.gain.setValueAtTime(.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + duration);
    } catch (_) { /* Audio is an optional enhancement. */ }
  }
  function reset() {
    phase = 'placement'; orientation = 'horizontal'; selectedShip = FLEET[0].id;
    playerShips = []; enemyShips = []; playerShots = new Set(); enemyShots = new Set(); playerHits = new Set(); enemyHits = new Set();
    logs = []; busy = false;
    $('logCount').textContent = '00';
    $('eventLog').innerHTML = '<div class="log-empty"><span>◌</span> Awaiting transmission...</div>';
    render();
    showToast('New mission initialized. Deploy your fleet.');
  }

  $('rotateButton').addEventListener('click', rotate);
  $('autoButton').addEventListener('click', autoDeploy);
  $('launchButton').addEventListener('click', launch);
  $('resetButton').addEventListener('click', reset);
  $('soundButton').addEventListener('click', () => {
    soundOn = !soundOn;
    $('soundButton').classList.toggle('muted', !soundOn);
    $('soundLabel').textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    if (soundOn) playTone(520, .08);
  });
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'r' && !event.repeat && !event.target.matches('input,textarea')) rotate();
  });
  updateAxes();
  render();
})();
