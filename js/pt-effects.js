/*
 * Efeitos do playtest (zoeira, sem texto e sem emoji). Duas fontes de decisão, nunca uma lista de cartas:
 *  - a COR da carta jogada dá o efeito-assinatura: vermelho = raio, branco = luz divina, azul = onda, preto = vazio,
 *    verde = vinhas e folhas, incolor = brilho de metal;
 *  - palavras do TÍTULO dão um efeito extra, ou trocam o da cor (Lightning = raio, Tidal = onda, Frost = gelo...).
 * Destruição global (texto "destroy/exile all") derruba a página; fetch land (texto "sacrifice ... search") abre a escolha de terreno.
 * PtFx.analyze(cartaScryfall) é puro e testável; PtFx.fx.* só existe no navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.PtFx = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const BASIC_COLOR = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
  const LAND_TYPES = { plains: 'Plains', plain: 'Plains', island: 'Island', islands: 'Island', swamp: 'Swamp', swamps: 'Swamp', mountain: 'Mountain', mountains: 'Mountain', forest: 'Forest', forests: 'Forest' };
  const COLOR_LETTER = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
  const num = w => NUM[w] || (/^\d+$/.test(w) ? +w : 1);

  const frontOf = c => (c.card_faces && c.card_faces[0]) || c;
  const oracleOf = c => {
    const f = c.card_faces;
    if (!f || !f.length) return c.oracle_text || '';
    return c.layout === 'modal_dfc' ? (f[0].oracle_text || '') : f.map(x => x.oracle_text || '').join('\n');
  };

  /**
   * Perfil da carta, só por texto de regras e tipo: land, spell, creature, planeswalker, artifact, enchantment, haste, colors,
   * fetch + fetchTypes (['Island','Mountain'] ou as cinco básicas), tapMana, wrath { kinds }.
   * Também analisa damage/target/draw/ramp/alt (ficam guardados para quando as mágicas ganharem comportamento próprio).
   */
  function analyze(card) {
    const t = oracleOf(card).toLowerCase(), type = frontOf(card).type_line || card.type_line || '';
    const p = {
      type, land: /\bland\b/i.test(type), spell: /\b(instant|sorcery)\b/i.test(type), creature: /\bcreature\b/i.test(type),
      planeswalker: /\bplaneswalker\b/i.test(type), artifact: /\bartifact\b/i.test(type), enchantment: /\benchantment\b/i.test(type),
      haste: /\bhaste\b/.test(t), colors: card.colors || (frontOf(card).colors) || [],
      fetch: false, fetchTypes: [], tapMana: false, wrath: null, damage: 0, target: null, draw: 0, ramp: null, alt: null,
    };
    // terreno que se sacrifica para buscar outro (fetch land, Evolving Wilds...): quais tipos pode buscar?
    const f = p.land && /sacrifice/.test(t) && t.match(/search your library for an? ([^.]*?) card/);
    if (f) {
      p.fetch = true;
      p.fetchTypes = /\bbasic land\b/.test(f[1]) ? BASICS.slice() : [...new Set((f[1].match(/plains|islands?|swamps?|mountains?|forests?/g) || []).map(w => LAND_TYPES[w]))];
      if (!p.fetchTypes.length) p.fetchTypes = BASICS.slice();
    }
    p.tapMana = (card.produced_mana || []).length > 0 && (p.land || (/\{t\}/.test(t) && /\badd\b/.test(t)));
    if (p.land) return p;

    // destrua/exile todos: varre a mesa (e a página)
    const kinds = [];
    for (const w of t.matchAll(/(?:destroy|exile) all ([a-z ]+?)(?:[.,;]| and | that | you | with | of | except |$)/g)) {
      const n = w[1];
      const k = /nonland permanent/.test(n) ? '!Land' : /permanent/.test(n) ? '*' : /creature/.test(n) ? 'Creature' : /artifact/.test(n) ? 'Artifact' : /enchantment/.test(n) ? 'Enchantment' : /planeswalker/.test(n) ? 'Planeswalker' : /land/.test(n) ? 'Land' : null;
      if (k && !kinds.includes(k)) kinds.push(k);
    }
    if (kinds.length) p.wrath = { kinds };

    // (guardado) efeitos de mágica por texto
    if (/counter target/.test(t)) p.target = 'counter';
    else if (/destroy target/.test(t)) p.target = 'destroy';
    else if (/exile target/.test(t)) p.target = 'exile';
    else if (/return target [^.]*?to (?:its|their) owner'?s? hand/.test(t)) p.target = 'bounce';
    else if (/\btap target/.test(t)) p.target = 'tap';
    const d = t.match(/deals? (\d+|x) damage to (?:any target|target|each target)/);
    if (d) p.damage = /^\d+$/.test(d[1]) ? +d[1] : 3;
    const dr = p.spell && t.match(/draws? (a|an|one|two|three|four|five|\d+) cards?/);
    if (dr) p.draw = Math.min(4, num(dr[1]));
    if (p.spell && /search your library for [^.]*?(?:basic )?land card/.test(t)) {
      const table = /put one onto the battlefield/.test(t) ? 1 : /onto the battlefield/.test(t) ? (/up to two|two basic|put (?:them|both|those)/.test(t) ? 2 : 1) : 0;
      const hand = /into your hand/.test(t) ? 1 : 0;
      if (table || hand) p.ramp = { table, hand };
    }
    let m;
    if ((m = t.match(/sacrifice (a|an|one|two|three|\d+) (plains|islands?|swamps?|mountains?|forests?) rather than pay/))) p.alt = { kind: 'sacrifice', type: LAND_TYPES[m[2]], n: num(m[1]) };
    else if ((m = t.match(/exile (a|an|one|two) (white|blue|black|red|green) cards? from your hand rather than pay/))) p.alt = { kind: 'exile-hand', color: COLOR_LETTER[m[2]], n: num(m[1]) };
    else if ((m = t.match(/return (an?|one|two) (plains|islands?|swamps?|mountains?|forests?) you control to (?:its|their) owner'?s? hand rather than pay/))) p.alt = { kind: 'return', type: LAND_TYPES[m[2]], n: num(m[1]) };
    return p;
  }

  /** Qual terreno da biblioteca entra no lugar do fetch? Duais com tipo básico primeiro (melhor para pior), básicos por último. */
  function landScore(typeLine, oracle) {
    const types = (String(typeLine).match(/Plains|Island|Swamp|Mountain|Forest/g) || []).length, o = String(oracle || '').toLowerCase();
    if (/\bbasic\b/i.test(typeLine)) return 10;
    let s = 100 + (types >= 2 ? 40 : 0);
    const enters = /enters (?:the battlefield )?tapped/.test(o), cond = /unless|you may pay|if you control|if you don't|fewer/.test(o);
    if (enters && !cond) s -= 40;                                   // terreno que entra virado
    else if (enters && cond) s -= 8 + (/pay 2 life/.test(o) ? 0 : 4);   // shock lands e parentes: virado só se você não pagar
    if (types >= 3) s -= 5;                                         // triomes
    return s;
  }
  const colorOfType = t => BASIC_COLOR[t];

  function hitByWrath(kinds, prof) {
    return kinds.some(k => k === '*' || (k === '!Land' ? !prof.land : new RegExp('\\b' + k + '\\b', 'i').test(prof.type)));
  }

  // ------------------------------------------------------------------ palavras do título (nunca uma lista de cartas)
  /** Regras por palavra do título, na ordem de prioridade. Chaves que são assinatura de cor: bolt/fire (R), divine (W), tide (U), void (B), vines (G). */
  const TITLE_RULES = [
    ['bolt', /\b(lightning|thunder|bolt|shock|zap|spark|volt|electr|jolt|galvan|static)/],
    ['meteor', /\b(meteor|comet|asteroid|armageddon|apocalypse|annihilat|obliterat|extinction|cataclysm|doomsday|impact)/],
    ['fire', /\b(fire|flame|burn(?!ish)|inferno|blaze|pyre|ember|scorch|scald|char\b|magma|lava|immolat|incinerat|sear\b|ignit|explo|hellfire|torch|kindle|flare|conflagrat|brimstone|smolder|cinder|volcan)/],
    ['tide', /\b(water|tide|tidal|wave|flood|deluge|tsunami|aqua|sea\b|ocean|river|drown|lake|splash|bubble|current|whirlpool|torrent|cascade|surge|rain|drench|soak|geyser|fountain|spring\b)/],
    ['storm', /(storm|hurricane|tempest|monsoon)/],
    ['ice', /\b(frost|ice\b|icy|freez|frozen|glacier|blizzard|winter|snow|chill|hail|arctic|tundra|permafrost|cold|sleet)/],
    ['wind', /\b(drift|float|flutter|soar|glide|wind|gust|tornado|cyclone|whirl|gale|breeze|zephyr|updraft|squall|air\b|sky|cloud|vortex|twister)/],
    ['earth', /\b(earthquake|quake|tremor|avalanche|landslide|boulder|rockslide|stomp|colossal|titan|behemoth|giant|stampede|trample|crush|smash|pummel|rubble|seism)/],
    ['void', /\b(murk|crypt|tomb|coffin|sarcophag|catacomb|mausoleum|cemetery|skull|bone|shadow|dark|night|death|doom|grave|dread|nightmare|void|abyss|reaper|necro|lich|curse|hex\b|gloom|dusk|eclipse|midnight|sinister|ominous)/],
    ['divine', /\b(gods?\b|smite|judg(?:e)?ment|verdict|retribution|sol\b|light up|lantern|lamp|candle|spotlight|beacon|glow|lumin|sun\b|sunlit|sunburst|dawn|holy|radiant|divine|glory|sacred|heaven|solar|celestial|aurora|halo|shining|blessed|angel|seraph)/],
    ['vines', /\b(cultivat|grow|farm|plant|orchard|forest|vine|wild|woods|jungle|thicket|briar|bramble|root\b|tree|leaf|leaves|spore|fungus|moss|garden|grove|overgrow|fern|thorn|nature|bloom|sprout|seed|harvest)/],
    ['time', /\b(time|stasis|hourglass|temporal|chrono|eternal|eternity|epoch|aeon|yesterday|tomorrow|timeless)/],
    ['slash', /\b(skewer|pierce|stab|impale|spear|lance|arrow|javelin|dart|fang|claw|talon|sword|blade|slash|dagger|axe\b|cleave|sever|rend\b|reave|slice|cut\b|knife|saber|scimitar|katana|razor|scythe|guillotine)/],
    ['rage', /\b(wrath|fury|furious|rage|anger|rampage|frenzy|berserk|tantrum)/],
    ['force', /\b(force|power|might|strength|push|shove|repel|shockwave|gravity|pressure)/],
    ['steam', /(steam|vapor|smoke|\bmist|\bfog\b|haze|\bvent|exhale|boil)/],
    ['mirror', /\b(mirror|reflect|echo|twin|double|clone|copy|duplic|doppel|replicat|mimic|imitat)/],
    ['party', /\b(stage|theater|theatre|revel|party|fiesta|festival|celebrat|parade|carnival|circus|jester|clown|joke|fool|prank)/],
    ['zerg', /\b(swarm|horde|zerg|army|legion|locust|infest|invasion|stampede|mob\b|flock|pack\b|brood|colony|hive)/],
    ['ghost', /\b(ghost|spirit|specter|spectre|wraith|phantom|banshee|haunt|apparition|poltergeist|wisp)/],
    ['rainbow', /\b(rainbow|prism|chromatic|spectrum|kaleido|iridescent|color|colour)/],
  ];
  /** Chaves do título que são assinatura de cor (a chave toma o lugar do efeito da cor). */
  const SIG_KEYS = ['bolt', 'fire', 'tide', 'divine', 'void', 'vines'];
  /** Até 2 chaves de efeito para o título. */
  function titleKeys(name) {
    const n = String(name || '').split(' // ')[0].toLowerCase(), out = [];
    for (const [key, re] of TITLE_RULES) { if (out.length >= 2) break; if (re.test(n)) out.push({ key }); }
    return out;
  }
  const COLOR_SIG = { R: 'bolt', W: 'divine', U: 'tide', B: 'void', G: 'vines' };
  /** Quais efeitos tocam ao jogar a carta: [assinatura, extra?]. colors = ['R','G'] etc.; [] = incolor. */
  function castKeys(name, colors, rnd) {
    const r = rnd || Math.random, keys = titleKeys(name).map(k => k.key), out = [];
    const sig = keys.find(k => SIG_KEYS.includes(k));
    if (sig) out.push(sig);
    else out.push(colors && colors.length ? COLOR_SIG[colors[Math.floor(r() * colors.length)]] || 'metal' : 'metal');
    const extra = keys.find(k => !SIG_KEYS.includes(k));
    if (extra) out.push(extra);
    return out;
  }

  /** Terreno virado: efeito discreto pelo nome (Island, Mountain, Forest, Swamp, Plains e primos). */
  const LAND_RULES = [
    ['ember', /\b(volcan|lava|magma|scorch|scald|cinder|inferno)/], ['bubbles', /\b(swamp|bog|marsh|mire|fen\b|cesspool|sump)/], ['ripple', /\b(island|sea\b|ocean|lake|river|tide|water|lagoon|coast|reef|harbor|flood)/],
    ['dust', /\b(mountain|crag|peak|cliff|canyon|hill|rock|stone|badland|desert|sand)/], ['leaves', /\b(forest|woods|grove|jungle|wild|garden|thicket|vine|tropic|savann|grass|bayou)/],
    ['snow', /\b(tundra|ice\b|snow|glacier|frost|taiga|arctic)/], ['sunray', /\b(plains|prairie|field|meadow|sun\b|temple|steppe|plateau|hallowed|sacred|brightclimb)/],
  ];
  function landKey(name) { const n = String(name || '').toLowerCase(); const r = LAND_RULES.find(x => x[1].test(n)); return r ? r[0] : null; }

  // ------------------------------------------------------------------ animações (só no navegador)
  const fx = {};
  if (root && typeof document !== 'undefined') {
    const rr = (a, b) => a + Math.random() * (b - a);
    const once = (el, cls, ms) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
    const spawn = (cls, x, y, html, ms) => { const e = document.createElement('div'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px'; if (html) e.innerHTML = html; document.body.appendChild(e); setTimeout(() => e.remove(), ms || 900); return e; };
    const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 + root.scrollX, r.top + r.height / 2 + root.scrollY]; };
    const overlay = (cls, ms, html) => spawn('ptov ' + cls, 0, 0, html || '', ms);
    let gagBusy = false, gagTimers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); gagTimers.push(t); return t; };
    const LEAF = c => `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 1C5.5 6 3.5 13 6 22c9-1 15-8 13-21-2.5.4-5 .4-7 0z" fill="${c}"/><path d="M12 5v16M12 11l-4 -3M12 15l4 -3" stroke="rgba(255,255,255,.55)" stroke-width="1.2" fill="none"/></svg>`;

    // ---- básicos
    fx.shake = el => once(el, 'fx-shake', 520);
    fx.burn = el => once(el, 'fx-burn', 700);
    fx.pop = el => once(el, 'fx-appear', 600);
    fx.sheen = el => once(el, 'fx-sheen', 1000);
    fx.poof = el => { const [x, y] = center(el); for (let i = 0; i < 6; i++) spawn('ptpuff', x + rr(-30, 30), y + rr(-30, 30), '', 700); };
    fx.flash = warm => spawn('ptflash' + (warm ? ' warm' : ''), 0, 0, '', 360);
    fx.quake = () => { document.body.classList.add('pt-quake'); setTimeout(() => document.body.classList.remove('pt-quake'), 520); };
    fx.leave = (el, how, done) => { el.classList.add('fx-' + how); setTimeout(() => { el.remove(); done && done(); }, how === 'spin' ? 950 : how === 'shatter' ? 750 : 650); };
    fx.scorch = (el, dmg) => {
      const [x, y] = center(el), size = 90 + Math.min(10, dmg || 2) * 22;
      const s = spawn('ptscorch', x - size / 2, y - size / 2, '', 3600000); s.style.width = s.style.height = size + 'px';
      s.style.borderRadius = '48% 52% 45% 55% / 55% 45% 52% 48%'; s.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
      for (let i = 0; i < 6; i++) later(() => { const e = spawn('ptember', x + rr(-size * .35, size * .35), y + rr(-size * .2, size * .2), '', 1300); e.style.setProperty('--r', Math.random()); }, i * 90);
    };
    fx.crater = (el, big) => { const [x, y] = center(el), s = big ? 440 : 230; const c = spawn('ptcrater', x - s / 2, y - s * .3, '', 3600000); c.style.width = s + 'px'; c.style.height = s * .6 + 'px';
      let d = ''; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + rr(-.2, .2), l = rr(.55, 1.05) * s * .62; d += `M${s * .5} ${s * .3} L${(s * .5 + Math.cos(a) * l).toFixed(0)} ${(s * .3 + Math.sin(a) * l * .62).toFixed(0)} `; }
      c.innerHTML = `<svg viewBox="0 0 ${s} ${s * .6}" width="${s}" height="${s * .6}"><path d="${d}" stroke="#120c07" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/></svg>`; };
    fx.clear = () => { document.querySelectorAll('.ptscorch, .ptcrack, .ptcrater').forEach(e => e.remove()); fx.cancelGags(); };

    // ---- gags da página inteira (letras que caem, barrel roll, ondas...): tudo volta ao normal no fim
    const SKIP_TAG = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|SELECT|OPTION)$/;
    function collectWords(max) {
      const vw = root.innerWidth, vh = root.innerHeight, out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (!n.nodeValue.trim() || !n.parentElement || SKIP_TAG.test(n.parentElement.tagName) || n.parentElement.closest('.ptcard,.ptov,.ptgh-layer,#grimoire,#ptend,.ptflash,.ptmana,.ptpick')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      let n;
      while ((n = w.nextNode()) && out.length < max) {
        const cs = getComputedStyle(n.parentElement); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const big = parseFloat(cs.fontSize) >= 22, re = big ? /\S/g : /\S+/g; let m;
        while ((m = re.exec(n.nodeValue)) && out.length < max) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          const b = r.getBoundingClientRect();
          if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) continue;
          out.push({ t: m[0], b, font: cs.font, color: cs.color, ls: cs.letterSpacing, tt: cs.textTransform });
        }
      }
      return out;
    }
    /** mode: 'gravity' (cai e empilha), 'float' (sobe), 'hole' (buraco negro), 'blast' (explode). (ox, oy) = origem na janela. */
    function wordsFly(mode, ox, oy) {
      if (gagBusy) return; gagBusy = true;
      const words = collectWords(900), vw = root.innerWidth, vh = root.innerHeight;
      const layer = document.createElement('div'); layer.className = 'ptgh-layer'; document.body.appendChild(layer);
      const gh = words.map(o => { const s = document.createElement('span'); s.className = 'ptgh'; s.textContent = o.tt === 'uppercase' ? o.t.toUpperCase() : o.t; s.style.cssText = `left:${o.b.left}px;top:${o.b.top}px;font:${o.font};color:${o.color};letter-spacing:${o.ls};line-height:${o.b.height}px`; layer.appendChild(s); return { s, o }; });
      document.body.classList.add('pt-ghosted');
      const pile = new Array(Math.ceil(vw / 18) + 2).fill(0);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        gh.forEach(({ s, o }) => {
          const cx = o.b.left + o.b.width / 2, cy = o.b.top + o.b.height / 2, d = Math.hypot(cx - ox, cy - oy), delay = Math.round(d / vw * 520 + rr(0, 240));
          let tx = 0, ty = 0, rot = 0, sc = 1, dur = 900, ease = 'cubic-bezier(.5,0,1,.55)';
          if (mode === 'gravity') { const col = Math.max(0, Math.min(pile.length - 1, Math.floor(cx / 18))); pile[col] += o.b.height * .55; ty = vh - o.b.top - o.b.height - pile[col] + rr(-4, 8); tx = rr(-14, 14); rot = rr(-85, 85); dur = 800 + rr(0, 700); }
          else if (mode === 'float') { ty = -(o.b.bottom + rr(80, 420)); tx = rr(-80, 80); rot = rr(-40, 40); dur = 1500 + rr(0, 900); ease = 'cubic-bezier(.2,.7,.3,1)'; }
          else if (mode === 'hole') { tx = ox - cx; ty = oy - cy; sc = .04; rot = rr(540, 900); dur = 1100 + rr(0, 500); ease = 'cubic-bezier(.6,0,.8,.4)'; }
          else { const a = Math.atan2(cy - oy, cx - ox), dd = 140 + rr(0, 560); tx = Math.cos(a) * dd; ty = Math.sin(a) * dd; rot = rr(-420, 420); sc = rr(.6, 1.5); dur = 900 + rr(0, 500); ease = 'cubic-bezier(.1,.8,.3,1)'; }
          s.style.transition = `transform ${dur}ms ${ease} ${delay}ms`; s.style.transform = `translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${sc})`;
        });
      }));
      const hold = mode === 'gravity' ? 3300 : mode === 'blast' ? 1900 : 2200;
      later(() => { gh.forEach(({ s }) => { s.style.transition = `transform ${800 + rr(0, 500)}ms cubic-bezier(.3,.7,.3,1) ${rr(0, 350)}ms`; s.style.transform = 'none'; }); }, 1900 + hold);
      later(() => { layer.remove(); document.body.classList.remove('pt-ghosted'); gagBusy = false; }, 1900 + hold + 1500);
    }
    const pageFx = (cls, ms, setup) => { const h = document.documentElement; if (h.dataset.ptg) return; h.dataset.ptg = '1'; if (setup) setup(h); h.classList.add(cls); later(() => { h.classList.remove(cls); delete h.dataset.ptg; h.style.removeProperty('transform-origin'); }, ms); };
    const midOrigin = h => { h.style.transformOrigin = `50% ${root.scrollY + root.innerHeight / 2}px`; };
    fx.gag = (kind, el) => {
      const [px, py] = center(el), ox = px - root.scrollX, oy = py - root.scrollY;
      if (kind === 'gravity' || kind === 'float' || kind === 'hole' || kind === 'blast') wordsFly(kind, ox, oy);
      else if (kind === 'barrel') pageFx('pt-barrel', 1900, midOrigin);
      else if (kind === 'mirrorpage') pageFx('pt-mirrorpage', 2300, midOrigin);
      else if (kind === 'disco') pageFx('pt-disco', 3200);
      else if (kind === 'underwater') pageFx('pt-underwater', 3400, () => { if (!document.getElementById('ptwaterfx')) { const d = document.createElement('div'); d.id = 'ptwaterfx'; d.innerHTML = '<svg width="0" height="0" style="position:absolute"><filter id="ptwater" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency="0.008 0.02" numOctaves="2" seed="3" result="t"><animate attributeName="baseFrequency" dur="3.4s" values="0.008 0.02;0.016 0.034;0.008 0.02" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="26"/></filter></svg>'; document.body.appendChild(d); } });
    };
    fx.cancelGags = () => { gagTimers.forEach(clearTimeout); gagTimers = []; document.querySelectorAll('.ptgh-layer').forEach(e => e.remove()); document.body.classList.remove('pt-ghosted', 'pt-gray'); const h = document.documentElement; ['pt-barrel', 'pt-mirrorpage', 'pt-disco', 'pt-underwater'].forEach(c => h.classList.remove(c)); delete h.dataset.ptg; h.style.removeProperty('transform-origin'); gagBusy = false; };
    /** O fim da Cólera de Deus: a tela apaga por um instante (sem texto, sem emoji). */
    fx.blackout = () => overlay('ptblackout', 2000);

    // ---- assinaturas de cor (animações marcantes, rápidas, sem emoji)
    const E = {
      bolt: el => { const [x, y] = center(el), top = root.scrollY, h = Math.max(70, y - top), w = 240, pts = []; let px = w / 2;
        for (let i = 0; i <= 9; i++) { px = i === 9 ? w / 2 : Math.max(24, Math.min(w - 24, px + rr(-38, 38))); pts.push(px.toFixed(0) + ',' + (h * i / 9).toFixed(0)); }
        spawn('ptbolt', x - w / 2, top, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts.join(' ')}" fill="none" stroke="#9fd0ff" stroke-width="14" stroke-linejoin="round" opacity=".55"/><polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>`, 420);
        fx.flash(); fx.quake(); fx.burn(el); later(() => fx.scorch(el, 2), 120); },
      fire: el => { fx.scorch(el, 4); fx.burn(el); const vw = root.innerWidth;
        for (let i = 0; i < 16; i++) { const f = spawn('ptflame', root.scrollX + (i + rr(-.3, .3)) * vw / 15 - 40, root.scrollY + root.innerHeight - 10, '', 1300); f.style.width = rr(70, 130) + 'px'; f.style.height = rr(140, 260) + 'px'; f.style.animationDelay = rr(0, 220) + 'ms'; } },
      divine: el => { const [x, y] = center(el), top = root.scrollY; const b = spawn('ptdivine', x - 90, top, '', 1700); b.style.height = Math.max(90, y - top + 40) + 'px';
        spawn('ptrays', x - 150, y - 150, '', 1500); fx.flash(true); once(el, 'fx-gold', 1300);
        for (let i = 0; i < 8; i++) later(() => spawn('ptspark', x + rr(-70, 70), y + rr(-90, 60), '', 900), i * 80); },
      tide: el => { overlay('ptwave', 2700, '<i class="w1"></i><i class="w2"></i>'); if (Math.random() < .55) fx.gag('underwater', el); const [x, y] = center(el); for (let i = 0; i < 3; i++) { const r = spawn('ptripple', x, y, '', 1100); r.style.animationDelay = (i * 160) + 'ms'; } },
      void: el => { const [x, y] = center(el); spawn('ptvoid', x - 110, y - 110, '', 1500); overlay('ptdim', 1700); if (Math.random() < .7) fx.gag('hole', el); },
      vines: el => { const [x] = center(el), bottom = root.scrollY + root.innerHeight, [, y] = center(el), h = Math.max(120, bottom - y + 60), w = 260;
        for (let v = 0; v < 3; v++) { const x0 = w / 2 + (v - 1) * 70, pts = []; for (let i = 0; i <= 8; i++) pts.push([x0 + Math.sin(i * 1.3 + v) * 34, h - i * h / 8]);
          const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join(' ');
          const leaves = pts.filter((_, i) => i % 2 === 1).map((p, i) => `<g transform="translate(${p[0].toFixed(0)} ${p[1].toFixed(0)}) rotate(${i % 2 ? 50 : -50})"><g><animateTransform attributeName="transform" type="scale" from="0" to="1" begin="${(.25 + i * .12).toFixed(2)}s" dur=".25s" fill="freeze"/><g transform="translate(-12 -22)">${LEAF(['#4caf50', '#7bc043', '#2e8b57'][i % 3])}</g></g></g>`).join('');
          spawn('ptvine', x - w / 2, bottom - h, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#3b8a2f" stroke-width="6" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".7s" begin="${(v * .08).toFixed(2)}s" fill="freeze"/></path>${leaves}</svg>`, 1700); }
        for (let i = 0; i < 14; i++) { const l = spawn('ptleaf', x, y, LEAF(['#4caf50', '#8bc34a', '#2e7d32', '#aed581'][i % 4]), 1500); const a = rr(0, Math.PI * 2), d = rr(90, 260); l.style.setProperty('--lx', Math.cos(a) * d + 'px'); l.style.setProperty('--ly', Math.sin(a) * d - 40 + 'px'); l.style.setProperty('--lr', rr(-540, 540) + 'deg'); l.style.animationDelay = rr(0, 260) + 'ms'; } },
      metal: el => { fx.sheen(el); fx.quake(); const [x, y] = center(el); for (let i = 0; i < 3; i++) { const r = spawn('ptripple force', x, y, '', 900); r.style.animationDelay = (i * 120) + 'ms'; r.style.borderColor = 'rgba(210,220,235,.95)'; } },
      // ---- extras por título (globais)
      meteor: el => { const [x, y] = center(el); const m = spawn('ptfireball', x - 340, y - 460, '', 1000); m.style.setProperty('--tx', '340px'); m.style.setProperty('--ty', '460px'); later(() => { fx.crater(el, true); fx.gag('blast', el); fx.scorch(el, 6); fx.quake(); fx.flash(true); }, 560); },
      earth: el => { fx.crater(el, false); fx.quake(); if (Math.random() < .4) fx.gag('gravity', el); const [x, y] = center(el), h = el.offsetHeight || 126; for (let i = 0; i < 7; i++) { const p = spawn('ptpuff dust', x + rr(-60, 60), y + h / 2 - 6, '', 800); p.style.animationDelay = (i * 40) + 'ms'; } },
      ice: el => { overlay('ptfrost', 2300); const vw = root.innerWidth, vh = root.innerHeight; for (let i = 0; i < 12; i++) { const top = i % 2 === 1, h = rr(80, 190), s = spawn('ptshard' + (top ? ' top' : ''), root.scrollX + rr(0, vw), root.scrollY + (top ? -6 : vh - h + 6), '', 2200); s.style.height = h + 'px'; s.style.animationDelay = rr(0, 300) + 'ms'; } once(el, 'fx-frozen', 2300); },
      wind: el => fx.gag(Math.random() < .5 ? 'float' : 'barrel', el),
      time: el => { document.body.classList.add('pt-gray'); setTimeout(() => document.body.classList.remove('pt-gray'), 1000); const [x, y] = center(el); spawn('ptclock', x - 44, y - 44, '<svg viewBox="0 0 88 88" width="88" height="88"><circle cx="44" cy="44" r="40" fill="rgba(20,20,30,.55)" stroke="#fff" stroke-width="4"/><path d="M44 44V18" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M44 44L62 52" stroke="#ffd34d" stroke-width="4" stroke-linecap="round"/></svg>', 1100); },
      party: el => { fx.gag('disco', el); for (let i = 0; i < 28; i++) { const e = spawn('ptconf', root.scrollX + rr(0, root.innerWidth), root.scrollY - 10, '', 2200); e.style.background = ['#ff5a5a', '#ffd34d', '#5ac8ff', '#7be07b', '#c77bff'][i % 5]; e.style.animationDelay = rr(0, .7) + 's'; } },
      mirror: el => { if (Math.random() < .6) fx.gag('mirrorpage', el); const c = el.cloneNode(true); c.classList.add('fx-mirror'); c.style.pointerEvents = 'none'; c.removeAttribute('data-pid'); document.body.appendChild(c); setTimeout(() => c.remove(), 1100); },
      zerg: el => { const colors = ['#ea4335', '#fbbc05', '#34a853', '#4285f4']; for (let i = 0; i < 46; i++) later(() => { const ltr = Math.random() < .5, e = spawn('ptrun ' + (ltr ? 'ltr' : 'rtl') + ' zerg', root.scrollX + (ltr ? -40 : root.innerWidth + 10), root.scrollY + rr(40, root.innerHeight - 40), '', 2300); const s = rr(14, 34); e.style.width = e.style.height = s + 'px'; e.style.background = colors[i % 4]; e.style.setProperty('--w', root.innerWidth + 80 + 'px'); e.style.animationDuration = rr(1.2, 2.2) + 's'; }, i * 45); },
      force: el => { const [x, y] = center(el); const r = spawn('ptripple force', x, y, '', 900); r.style.animationDuration = '.8s';
        document.querySelectorAll('.ptcard:not(.ghost)').forEach(c => { if (c === el) return; const [cx, cy] = center(c), dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1; c.style.setProperty('--px', (dx / d * 46).toFixed(0) + 'px'); c.style.setProperty('--py', (dy / d * 46).toFixed(0) + 'px'); once(c, 'fx-push', 700); }); fx.quake(); },
      steam: el => { const [x, y] = center(el), h = el.offsetHeight || 126; for (let i = 0; i < 7; i++) { const p = spawn('ptpuff steam', x + rr(-50, 50), y + h / 3, '', 1300); p.style.animationDelay = (i * 90) + 'ms'; } },
      slash: el => { const [x, y] = center(el); spawn('ptslash', x - 170, y - 3, '', 700); once(el, 'fx-shake', 520); },
      rage: () => { overlay('ptrage', 1500); fx.quake(); },
      ghost: el => once(el, 'fx-ghost', 2100),
      rainbow: el => once(el, 'fx-rainbow', 1700),
      storm: () => { const o = overlay('ptrain', 3100); for (let i = 0; i < 70; i++) { const d = document.createElement('i'); d.style.left = rr(0, 100) + '%'; d.style.animationDelay = rr(0, 1.6) + 's'; d.style.animationDuration = rr(.45, .8) + 's'; d.style.height = rr(14, 30) + 'px'; o.appendChild(d); } later(() => { fx.flash(); fx.quake(); }, 350); },
    };
    /** Jogou a carta: assinatura da cor (ou do título) + no máximo um extra do título. */
    fx.cast = (name, colors, el) => { castKeys(name, colors).forEach((k, i) => later(() => E[k] && E[k](el), i * 280)); };

    /** Terreno que virou: efeito discreto pelo nome. */
    fx.land = (name, el) => {
      const k = landKey(name); if (!k) return; const [x, y] = center(el), h = el.offsetHeight || 126;
      if (k === 'ripple') for (let i = 0; i < 3; i++) { const r = spawn('ptripple', x, y, '', 1100); r.style.animationDelay = (i * 180) + 'ms'; }
      else if (k === 'bubbles') for (let i = 0; i < 7; i++) { const b = spawn('ptbubble', x + rr(-40, 40), y + h / 3, '', 1300); b.style.animationDelay = (i * 90) + 'ms'; b.style.width = b.style.height = rr(8, 18) + 'px'; }
      else if (k === 'ember') for (let i = 0; i < 6; i++) { const e = spawn('ptember', x + rr(-40, 40), y + h / 4, '', 1300); e.style.setProperty('--r', Math.random()); e.style.animationDelay = (i * 70) + 'ms'; }
      else if (k === 'dust') for (let i = 0; i < 6; i++) { const p = spawn('ptpuff dust', x + rr(-50, 50), y + h / 2 - 8, '', 800); p.style.animationDelay = (i * 40) + 'ms'; }
      else if (k === 'leaves') for (let i = 0; i < 6; i++) { const l = spawn('ptleaf small', x, y, LEAF(['#4caf50', '#8bc34a', '#2e7d32'][i % 3]), 1300); const a = rr(0, Math.PI * 2), d = rr(50, 120); l.style.setProperty('--lx', Math.cos(a) * d + 'px'); l.style.setProperty('--ly', Math.sin(a) * d - 30 + 'px'); l.style.setProperty('--lr', rr(-360, 360) + 'deg'); }
      else if (k === 'snow') for (let i = 0; i < 8; i++) { const s = spawn('ptsnow', x + rr(-50, 50), y - h / 3, '', 1500); s.style.animationDelay = (i * 80) + 'ms'; }
      else if (k === 'sunray') { const b = spawn('ptdivine small', x - 30, y - 170, '', 1000); b.style.height = '170px'; }
    };
  }

  return { analyze, hitByWrath, titleKeys, castKeys, landKey, landScore, colorOfType, BASICS, fx };
});
