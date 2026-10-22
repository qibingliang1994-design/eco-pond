import { KOI_PATTERNS } from './fish.js';
import { pondD, RX, RZ } from './pond.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

export function createUI(ctx) {
  const { fish, food, plants, eco, env, controls, setTime, state, flyTo, applyWater, shared, scenery, quality, markDirty, resetSave, saveInfo, weather } = ctx;
  let pattern = 'random', toastT = 0, immersive = false, fedHint = false;
  const ui = { tool: null };

  // pattern chips
  $('#patSeg').innerHTML = [{ id: 'random', name: '随机' }, ...KOI_PATTERNS].map(p => `<button data-pat="${p.id}" class="${p.id === 'random' ? 'on' : ''}">${p.name}</button>`).join('');
  $('#patSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; pattern = b.dataset.pat; $$('#patSeg button').forEach(x => x.classList.toggle('on', x === b)); });

  // panels: one at a time
  function openPanel(id) {
    const p = document.getElementById(id); const willOpen = p.hidden;
    $$('.panel').forEach(x => x.hidden = true); $$('#dock [data-panel]').forEach(b => b.classList.remove('on'));
    if (willOpen) { p.hidden = false; $(`#dock [data-panel="${id}"]`).classList.add('on'); }
  }
  ui.closePanels = () => { $$('.panel').forEach(x => x.hidden = true); $$('#dock [data-panel]').forEach(b => b.classList.remove('on')); };
  $$('#dock [data-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
  $$('.pclose').forEach(b => b.addEventListener('click', ui.closePanels));

  ui.toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); };
  ui.fedOnce = () => { if (!fedHint) { fedHint = true; ui.toast('投喂成功！鱼儿正游过来抢食'); } };

  function scatterFood() {
    for (let k = 0; k < 3; k++) {
      let x, z; do { x = (Math.random() * 2 - 1) * RX * 0.8; z = (Math.random() * 2 - 1) * RZ * 0.8; } while (pondD(x, z) > 0.75);
      food.spawn(x, z, 7);
    }
    ui.toast('撒下一把鱼食');
  }
  const acts = {
    'koi+': () => { if (fish.count('koi') >= 24) return ui.toast('锦鲤最多 24 条'); fish.addKoi(pattern); },
    'koi-': () => fish.remove('koi'),
    'gold+': () => { if (fish.count('gold') >= 20) return ui.toast('金鱼最多 20 条'); fish.addGold(); },
    'gold-': () => fish.remove('gold'),
    feedAll: scatterFood,
    clearFood: () => { food.clear(); ui.toast('已清理水面残饵'); },
    undoPlant: () => { if (!plants.removeLast()) ui.toast('没有可撤销的植物'); },
    clearPlant: () => { plants.clear(); ui.toast('已清空全部植物'); },
    immersive: () => setImmersive(true),
    saveNow: () => { if (saveInfo().fresh) return ui.toast('临时模式（?fresh）下不保存'); window.ecoPond.saveNow(); ui.toast('已保存'); },
  };
  const NO_DIRTY = new Set(['immersive', 'saveNow']);
  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && acts[b.dataset.act]) { acts[b.dataset.act](); ui.refresh(true); if (!NO_DIRTY.has(b.dataset.act)) markDirty(); } });

  // plant tools
  const PLANT_NAMES = { lily: '睡莲叶', lotus: '荷花', reed: '芦苇', cattail: '香蒲' };
  function setTool(t) {
    ui.tool = t; $$('#plantTools button').forEach(b => b.classList.toggle('on', b.dataset.plant === t));
    $('#toolStatus').hidden = !t; if (t) { $('#toolText').textContent = `放置${PLANT_NAMES[t]}：点击${t === 'lily' || t === 'lotus' ? '水面' : '岸边或浅水'}`; ui.closePanels(); }
    document.body.style.cursor = t ? 'crosshair' : '';
  }
  $$('#plantTools button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.plant)));
  $('#toolDone').addEventListener('click', () => setTool(null));

  // environment
  const todName = t => t < 0.28 ? '白天' : t < 0.68 ? '黄昏' : '夜晚';
  const clockStr = t => { const m = t < 0.5 ? 12 * 60 + t / 0.5 * 390 : 18.5 * 60 + (t - 0.5) / 0.5 * 210; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`; };
  ui.syncTod = () => {
    $('#tod').value = Math.round(state.tod * 100);
    $('#todLabel').textContent = todName(state.tod);
    $('#clock').textContent = `${todName(state.tod)} ${clockStr(state.tod)}`;
  };
  $('#tod').addEventListener('input', e => { setTime(e.target.value / 100); ui.syncTod(); ui.refresh(); markDirty(); });

  $('#autoDay').addEventListener('change', e => { state.autoDay = e.target.checked; markDirty(); });
  $('#clarity').addEventListener('input', e => { state.clarity = e.target.value / 100; $('#clarV').textContent = e.target.value + '%'; applyWater(); markDirty(); });
  $('#wind').addEventListener('input', e => { const v = e.target.value / 100; shared.wind.value = v; if (weather) weather.st.baseWind = v; $('#windV').textContent = e.target.value + '%'; markDirty(); });
  
  // weather
  const WX_NAMES = { sunny: '晴天', cloudy: '多云', drizzle: '小雨', rain: '中雨', fog: '薄雾', snow: '小雪' };
  function syncWx() {
    if (!weather) return;
    $('#weather').value = weather.st.mode;
    $('#wxLabel').textContent = WX_NAMES[weather.st.mode] || weather.st.mode;
    $('#wxInt').value = Math.round(weather.st.intensity * 100);
    $('#wxV').textContent = Math.round(weather.st.intensity * 100) + '%';
    $('#autoWx').checked = weather.st.auto;
  }
  ui.syncWx = syncWx;
  $('#weather').addEventListener('change', e => {
    weather.setMode(e.target.value, weather.st.intensity); weather.st.auto = false; $('#autoWx').checked = false;
    syncWx(); setTime(state.tod); markDirty();
  });
  $('#wxInt').addEventListener('input', e => {
    weather.st.intensity = e.target.value / 100; $('#wxV').textContent = e.target.value + '%';
    $('#wxLabel').textContent = WX_NAMES[weather.st.mode] || '';
    setTime(state.tod); markDirty();
  });
  $('#autoWx').addEventListener('change', e => { weather.st.auto = e.target.checked; markDirty(); if (e.target.checked) ui.toast('自动天气：约每半分钟切换'); });

  $('#flies').addEventListener('change', e => { state.flies = e.target.checked; env.setFireflies(state.flies); markDirty(); });
  $('#refl').addEventListener('change', e => { state.refl = e.target.checked; applyWater(); markDirty(); if (state.refl && !quality.high) ui.toast('水面倒影仅在「精美」画质下开启'); });
  function setQuality(q) {
    quality.high = q === 'high'; $$('#qualSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === q));
    env.sun.castShadow = quality.high; scenery.grass.count = quality.high ? scenery.grassN : Math.floor(scenery.grassN * 0.4);
    ctx.renderer.setPixelRatio(Math.min(devicePixelRatio, quality.high ? 2 : 1.25)); dispatchEvent(new Event('resize')); applyWater();
  }
  $('#qualSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setQuality(b.dataset.q); markDirty(); } });
  $$('#qualSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === (quality.high ? 'high' : 'low')));

  // views
  $$('[data-view]').forEach(b => b.addEventListener('click', () => { flyTo(b.dataset.view); }));
  $('#autoRot').addEventListener('change', e => { state.autoRot = controls.autoRotate = e.target.checked; markDirty(); });
  function setImmersive(on) {
    immersive = on; document.body.classList.toggle('immersive', on); $('#exitImm').hidden = !on; ui.closePanels();
    if (on) { setTool(null); controls.autoRotate = true; ui.toast('沉浸欣赏中，按 Esc 退出', 1800); } else controls.autoRotate = $('#autoRot').checked;
  }
  $('#exitImm').addEventListener('click', () => setImmersive(false));

  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($$('.panel').some(p => !p.hidden)) ui.closePanels();
    else if (ui.tool) setTool(null);
    else if (immersive) setImmersive(false);
  });

  // save status + reset (two-step confirm, no blocking dialogs)
  ui.saveStatus = () => {
    const i = saveInfo(), el = $('#saveInfo');
    if (i.fresh) el.textContent = '临时模式（?fresh），不保存';
    else if (i.lastSaved) { const d = new Date(i.lastSaved); el.textContent = `已自动保存 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
    else el.textContent = '尚未保存';
  };
  let resetArm = 0;
  $('#resetBtn').addEventListener('click', () => {
    const b = $('#resetBtn');
    if (!resetArm) { b.textContent = '再点一次确认重置'; resetArm = setTimeout(() => { resetArm = 0; b.textContent = '重置鱼池（清除存档）'; }, 3000); return; }
    clearTimeout(resetArm); resetSave();
  });
  // reflect restored state into the controls
  $('#tod').value = Math.round(state.tod * 100); $('#todLabel').textContent = todName(state.tod);
  $('#autoDay').checked = state.autoDay; $('#clarity').value = Math.round(state.clarity * 100); $('#clarV').textContent = Math.round(state.clarity * 100) + '%';
  $('#wind').value = Math.round(shared.wind.value * 100); $('#windV').textContent = Math.round(shared.wind.value * 100) + '%';
  $('#flies').checked = state.flies; $('#refl').checked = state.refl; $('#autoRot').checked = state.autoRot;
  syncWx();
  ui.saveStatus();

  // ecology readout
  const sat = v => v >= 70 ? ['饱足', 'good'] : v >= 40 ? ['适中', 'ok'] : v >= 20 ? ['有点饿', 'warn'] : ['饥饿', 'bad'];
  ui.refresh = () => {
    const q = eco.s.quality, s = fish.avgSatiety(), [qg, qc] = eco.grade(), [sg, sc] = sat(s);
    $('#qBar').style.width = q.toFixed(0) + '%'; $('#qVal').textContent = q.toFixed(0); $('#qGrade').textContent = qg; $('#qGrade').className = qc;
    $('#sBar').style.width = s.toFixed(0) + '%'; $('#sVal').textContent = fish.list.length ? s.toFixed(0) : '-'; $('#sGrade').textContent = fish.list.length ? sg : '无鱼'; $('#sGrade').className = sc;
    $('#nKoi').textContent = $('#koiN').textContent = fish.count('koi'); $('#nGold').textContent = $('#goldN').textContent = fish.count('gold');
    $('#nPlant').textContent = plants.count(); $('#nCap').textContent = `${eco.s.load.toFixed(1)}/${eco.s.capacity.toFixed(0)}`;
    $('#clock').textContent = `${todName(state.tod)} ${clockStr(state.tod)}`;
    const tip = $('#ecoTip'); let msg = '';
    if (eco.s.load > eco.s.capacity) msg = '鱼太多啦，多种些睡莲、芦苇来净化水质';
    else if (food.floating() > 40) msg = '水面残饵过多，小心水质变差';
    else if (fish.list.length && s < 30) msg = '鱼儿饿了，点击水面投喂吧';
    tip.textContent = msg; tip.classList.toggle('on', !!msg);
  };
  return ui;
}
