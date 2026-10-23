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
  /**
   * Cada cor tem uma "piscina" de variações; a variação vem do NOME da carta (hash estável: a mesma carta sempre tem o seu efeito,
   * cartas diferentes variam) ou de uma palavra do título, que força uma variação específica. Nada é lista de cartas.
   */
  const POOLS = {
    R: ['bolt', 'fire', 'meteor', 'lava', 'blast', 'breath', 'sparks', 'embers'],
    W: ['divine', 'sunburst', 'feathers', 'dome', 'halo'],
    U: ['tide', 'whirlpool', 'mist', 'jelly', 'bubbles', 'frost', 'rain'],
    B: ['void', 'hole', 'tendrils', 'ink', 'bats', 'web', 'wither'],
    G: ['vines', 'leafstorm', 'spores', 'petals', 'roots', 'grass'],
    C: ['metal', 'gears', 'laser'],
  };
  const VARIANTS = new Set(Object.values(POOLS).flat());
  /** Regras por palavra do título, na ordem de prioridade (as mais específicas primeiro). A chave é a variação que a palavra força. */
  const TITLE_RULES = [
    ['bolt', /\b(lightning|thunder|bolt|shock|zap|volt|electr|jolt|galvan|static)/],
    ['meteor', /\b(meteor|comet|asteroid|armageddon|apocalypse|annihilat|obliterat|extinction|cataclysm|doomsday|impact)/],
    ['breath', /\b(dragon|wyrm|drake|breath|flamethrower|dracolich)/],
    ['lava', /\b(lava|magma|volcan|eruption|molten|obsidian)/],
    ['blast', /\b(explo|bomb|blast|detonat|nuke|dynamite|boom|grenade|shrapnel|fireball)/],
    ['embers', /\b(ember|cinder|ash\b|smolder|char\b|coal|pyre)/],
    ['fire', /\b(fire|flame|burn(?!ish)|inferno|blaze|scorch|scald|immolat|incinerat|sear\b|ignit|hellfire|torch|kindle|flare|conflagrat|brimstone)/],
    ['rain', /(storm|hurricane|tempest|monsoon|rain|drizzle|shower|downpour)/],
    ['whirlpool', /\b(whirlpool|maelstrom|spiral|swirl|vortex)/],
    ['frost', /\b(frost|ice\b|icy|freez|frozen|glacier|blizzard|winter|snow|chill|hail|arctic|tundra|permafrost|cold|sleet)/],
    ['mist', /\b(mist|fog\b|haze|cloud|dew)/],
    ['jelly', /\b(jelly|bounce|rubber|elastic|slime|ooze|gel\b|pudding|blob|squish)/],
    ['bubbles', /\b(bubble|foam|soap|fizz|sparkling|soda)/],
    ['tide', /\b(water|tide|tidal|wave|flood|deluge|tsunami|aqua|sea\b|ocean|river|drown|lake|splash|current|torrent|cascade|surge|drench|soak|geyser|fountain)/],
    ['bats', /\b(bat\b|bats\b|vampire|blood|bite|count\b|bloodthirst|nocturnal)/],
    ['web', /\b(web|spider|silk|snare|cobweb|tangle|trap\b)/],
    ['ink', /\b(ink|oil\b|tar\b|pitch|sludge|squid|octopus|kraken)/],
    ['wither', /\b(wither|decay|rot\b|ruin|blight|plague|disease|pestilence|famine|starv|drain|sap\b|fade|rust|corrod)/],
    ['hole', /\b(hole|singularity|oblivion|nihil|vacuum|abyss|bottomless|collapse)/],
    ['void', /\b(void|nothing|empty|null|vanish|erase)/],
    ['tendrils', /\b(tendril|creep|crawl|shadow|dread|nightmare|horror|terror|fear|dark|night|death|doom|grave|reaper|necro|lich|curse|hex\b|gloom|eclipse|midnight|sinister|ominous|murk|crypt|tomb|skull|bone)/],
    ['sunburst', /\b(sunburst|solar|supernova|radian|brilliance|daybreak|sunrise|dawn|sun\b|sunlit)/],
    ['feathers', /\b(feather|wing|angel|seraph|dove|swan|archangel|halcyon)/],
    ['dome', /\b(shield|ward\b|barrier|protect|guard|aegis|bastion|sanctuary|wall\b|fortif|bulwark|refuge)/],
    ['halo', /\b(halo|ring\b|circle|oath|vow|sacred|holy|divine|blessed|glory)/],
    ['divine', /\b(gods?\b|smite|judg(?:e)?ment|verdict|retribution|sol\b|light up|lantern|lamp|candle|spotlight|beacon|glow|lumin|heaven|celestial|aurora|shining)/],
    ['spores', /\b(spore|mushroom|fungus|mold|mildew|toadstool|sporecap|myconid)/],
    ['petals', /\b(petal|blossom|flower|rose\b|lotus|bloom|sakura|cherry|lily|daisy|orchid|bouquet|spring\b)/],
    ['roots', /\b(root|tree|ent\b|treefolk|woods?\b|ancient|elder|oak|grove|thicket|briar)/],
    ['grass', /\b(grass|meadow|field|lawn|prairie|turf|hay|wheat|crop|farm|pasture)/],
    ['leafstorm', /\b(leaf|leaves|autumn|foliage|canopy|rustle|gale)/],
    ['vines', /\b(vine|creeper|ivy|bramble|thorn|overgrow|cultivat|grow|plant|jungle|wild|nature|seed|harvest|sprout|garden|moss|fern)/],
    ['gears', /\b(gear|cog\b|clock|machine|engine|golem|construct|automaton|myr\b|thopter|cogwork|assembly|mechan|forge|artisan|steel|iron)/],
    ['laser', /\b(laser|beam|ray\b|scan|radar|optic|eye\b|sight|target|aim\b|sniper|lens|photon|plasma)/],
    // efeitos globais extras (não são variações de cor)
    ['earth', /\b(earthquake|quake|tremor|avalanche|landslide|boulder|rockslide|stomp|colossal|titan|behemoth|giant|stampede|trample|crush|smash|pummel|rubble|seism)/],
    ['wind', /\b(drift|float|flutter|soar|glide|wind|gust|tornado|cyclone|whirl|breeze|zephyr|updraft|squall|air\b|sky|twister)/],
    ['time', /\b(time|stasis|hourglass|temporal|chrono|eternal|eternity|epoch|aeon|yesterday|tomorrow|timeless)/],
    ['slash', /\b(skewer|pierce|stab|impale|spear|lance|arrow|javelin|dart|fang|claw|talon|sword|blade|slash|dagger|axe\b|cleave|sever|rend\b|reave|slice|cut\b|knife|saber|scimitar|katana|razor|scythe|guillotine)/],
    ['rage', /\b(wrath|fury|furious|rage|anger|rampage|frenzy|berserk|tantrum)/],
    ['force', /\b(force|power|might|strength|push|shove|repel|shockwave|gravity|pressure)/],
    ['steam', /(steam|vapor|smoke|\bvent|exhale|boil)/],
    ['mirror', /\b(mirror|reflect|echo|twin|double|clone|copy|duplic|doppel|replicat|mimic|imitat)/],
    ['party', /\b(stage|theater|theatre|revel|party|fiesta|festival|celebrat|parade|carnival|circus|jester|clown|joke|fool|prank)/],
    ['zerg', /\b(swarm|horde|zerg|army|legion|locust|infest|invasion|mob\b|flock|pack\b|brood|colony|hive)/],
    ['ghost', /\b(ghost|spirit|specter|spectre|wraith|phantom|banshee|haunt|apparition|poltergeist|wisp)/],
    ['rainbow', /\b(rainbow|prism|chromatic|spectrum|kaleido|iridescent|color|colour)/],
  ];
  /** Chaves de efeito para o título (até 3, na ordem das regras). */
  function titleKeys(name) {
    const n = String(name || '').split(' // ')[0].toLowerCase(), out = [];
    for (const [key, re] of TITLE_RULES) { if (out.length >= 3) break; if (re.test(n)) out.push({ key }); }
    return out;
  }
  /** Hash estável do nome (FNV-1a): a mesma carta cai sempre na mesma variação. */
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  /**
   * Efeitos ao jogar a carta: [variação, extra?]. A variação vem da palavra do título (se houver) ou do hash do nome dentro da
   * piscina da cor da carta (multicolor: o hash também escolhe a cor). `extra` é um efeito global do título (gelo, cratera, disco...).
   */
  function castKeys(name, colors) {
    const base = String(name || '').split(' // ')[0].toLowerCase(), keys = titleKeys(name).map(k => k.key), cs = colors && colors.length ? colors : ['C'];
    let sig = keys.find(k => VARIANTS.has(k));
    if (!sig) { const pool = POOLS[cs[hash(base) % cs.length]] || POOLS.C; sig = pool[hash(base + '#v') % pool.length]; }
    const extra = keys.find(k => !VARIANTS.has(k));
    return extra ? [sig, extra] : [sig];
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
      else if (kind === 'jelly') pageFx('pt-jelly', 1400, midOrigin);
      else if (kind === 'underwater') pageFx('pt-underwater', 3400, () => { if (!document.getElementById('ptwaterfx')) { const d = document.createElement('div'); d.id = 'ptwaterfx'; d.innerHTML = '<svg width="0" height="0" style="position:absolute"><filter id="ptwater" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency="0.008 0.02" numOctaves="2" seed="3" result="t"><animate attributeName="baseFrequency" dur="3.4s" values="0.008 0.02;0.016 0.034;0.008 0.02" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="26"/></filter></svg>'; document.body.appendChild(d); } });
    };
    fx.cancelGags = () => { gagTimers.forEach(clearTimeout); gagTimers = []; document.querySelectorAll('.ptgh-layer').forEach(e => e.remove()); document.body.classList.remove('pt-ghosted', 'pt-gray'); const h = document.documentElement; ['pt-barrel', 'pt-mirrorpage', 'pt-disco', 'pt-underwater', 'pt-jelly'].forEach(c => h.classList.remove(c)); delete h.dataset.ptg; h.style.removeProperty('transform-origin'); gagBusy = false; };
    /** O fim da Cólera de Deus: a tela apaga por um instante (sem texto, sem emoji). */
    fx.blackout = () => overlay('ptblackout', 2000);

    // ---- peças comuns das variações
    const hashName = hash;
    const FEATHER = '<svg viewBox="0 0 24 40" width="100%" height="100%"><path d="M12 1C4 10 3 24 12 39 21 24 20 10 12 1z" fill="#fff" stroke="#dfe8f5" stroke-width="1"/><path d="M12 4v33" stroke="#c9d6ea" stroke-width="1.2"/></svg>';
    const PETAL = c => `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 2C18 6 20 14 12 22 4 14 6 6 12 2z" fill="${c}"/></svg>`;
    const BAT = '<svg viewBox="0 0 48 28" width="100%" height="100%"><path d="M24 6c-2 4-5 6-9 6C11 12 6 8 1 10c3 2 4 5 4 8 3-3 6-3 8 0 2-3 5-3 6-1l5 5 5-5c1-2 4-2 6 1 2-3 5-3 8 0 0-3 1-6 4-8-5-2-10 2-14 2-4 0-7-2-9-6z" fill="#14091f"/><circle cx="21" cy="9" r="1.1" fill="#ff4d6d"/><circle cx="27" cy="9" r="1.1" fill="#ff4d6d"/></svg>';
    const GEAR = '<svg viewBox="0 0 40 40" width="100%" height="100%"><circle cx="20" cy="20" r="13" fill="none" stroke="#b7c0cc" stroke-width="7" stroke-dasharray="5 4.1"/><circle cx="20" cy="20" r="11" fill="#8c97a6"/><circle cx="20" cy="20" r="4" fill="#2b3340"/></svg>';
    const vw = () => root.innerWidth, vh = () => root.innerHeight, sx = () => root.scrollX, sy = () => root.scrollY;
    /** Partículas: build(i) -> [classe extra, html, { x, y, dx, dy, rot, s, dur, delay, w }]. Voam de (x+o.x, y+o.y) por (dx, dy) e somem. */
    const parts = (x, y, n, build) => { for (let i = 0; i < n; i++) { const [cls, html, o] = build(i); const dur = o.dur || 1400, delay = o.delay || 0, e = spawn('ptp ' + cls, x + (o.x || 0), y + (o.y || 0), html, dur + delay + 250);
      e.style.setProperty('--dx', (o.dx || 0) + 'px'); e.style.setProperty('--dy', (o.dy || 0) + 'px'); e.style.setProperty('--rot', (o.rot || 0) + 'deg'); e.style.setProperty('--s', o.s || 1); e.style.setProperty('--dur', dur + 'ms'); e.style.setProperty('--delay', delay + 'ms'); if (o.w) { e.style.width = o.w + 'px'; e.style.height = (o.h || o.w) + 'px'; } } };
    const cornerSvg = (inner, w, h) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
    // ---- assinaturas de cor (animações marcantes, rápidas, sem emoji), ESCALADAS PELO CUSTO DE MANA:
    //   l = 1 (custo 0-2): sutil e local, nada que atrapalhe testar | l = 2 (custo 3-4): médio | l = 3 (custo 5+): bagunça a tela toda
    const lv = (l, a, b, c) => (l >= 3 ? c : l === 2 ? b : a);
    const cardH = el => el.offsetHeight || 168;
    const E = {
      // ===== vermelho
      bolt: (el, l) => { const [x, y] = center(el), top = sy(), h = Math.max(70, y - top), w = lv(l, 150, 190, 240), pts = []; let px = w / 2;
        for (let i = 0; i <= 9; i++) { px = i === 9 ? w / 2 : Math.max(24, Math.min(w - 24, px + rr(-38, 38))); pts.push(px.toFixed(0) + ',' + (h * i / 9).toFixed(0)); }
        spawn('ptbolt', x - w / 2, top, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts.join(' ')}" fill="none" stroke="#9fd0ff" stroke-width="${lv(l, 9, 12, 14)}" stroke-linejoin="round" opacity=".55"/><polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-width="${lv(l, 3, 4, 5)}" stroke-linejoin="round"/></svg>`, 420);
        fx.burn(el); if (l >= 2) later(() => fx.scorch(el, l === 2 ? 1 : 2), 120); if (l >= 3) { fx.flash(); fx.quake(); } },
      fire: (el, l) => { fx.burn(el); if (l >= 2) fx.scorch(el, lv(l, 1, 2, 4)); const [x, y] = center(el), n = lv(l, 5, 10, 16), span = lv(l, 160, 380, vw()), base = y + cardH(el) / 2;
        for (let i = 0; i < n; i++) { const left = l >= 3 ? sx() + (i + rr(-.3, .3)) * vw() / (n - 1) - 40 : x + (i / (n - 1) - .5) * span - 30, f = spawn('ptflame', left, l >= 3 ? sy() + vh() - 10 : base, '', 1300);
          f.style.width = rr(50, 100) * lv(l, .6, .85, 1.3) + 'px'; f.style.height = rr(90, 180) * lv(l, .55, .85, 1.5) + 'px'; f.style.animationDelay = rr(0, 220) + 'ms'; } },
      meteor: (el, l) => { const [x, y] = center(el), k = lv(l, .45, .7, 1), m = spawn('ptfireball', x - 340 * k, y - 460 * k, '', 1000); m.style.width = m.style.height = lv(l, 46, 62, 80) + 'px'; m.style.setProperty('--tx', 340 * k + 'px'); m.style.setProperty('--ty', 460 * k + 'px');
        later(() => { fx.scorch(el, lv(l, 1, 3, 6)); if (l >= 3) { fx.crater(el, true); fx.gag('blast', el); fx.quake(); fx.flash(true); } }, 560); },
      lava: (el, l) => { const [x, y] = center(el), n = lv(l, 4, 6, 8), f = lv(l, .45, .75, 1); let svg = ''; for (let i = 0; i < n; i++) { let px = 0, py = 0, a = i / n * Math.PI * 2 + rr(-.3, .3), d = ''; for (let k = 0; k < 6; k++) { a += rr(-.5, .5); px += Math.cos(a) * rr(40, 70) * f; py += Math.sin(a) * rr(40, 70) * f; d += ` L${px.toFixed(0)} ${py.toFixed(0)}`; } svg += `<path d="M0 0${d}" fill="none" stroke="#ff7a1a" stroke-width="${lv(l, 3, 4, 5)}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".5s" fill="freeze"/></path>`; }
        spawn('ptlava', x - 420, y - 420, `<svg width="840" height="840" viewBox="-420 -420 840 840">${svg}</svg>`, 2400); if (l >= 2) fx.scorch(el, 2); if (l >= 3) fx.quake(); },
      blast: (el, l) => { const [x, y] = center(el), r = spawn('ptripple force', x, y, '', 900); r.style.borderColor = '#ffb347'; fx.burn(el); if (l >= 2) fx.flash(true); if (l >= 3) { fx.gag('blast', el); fx.quake(); fx.scorch(el, 4); } },
      breath: (el, l) => { const [x, y] = center(el), h = lv(l, 70, 100, 140), left = l >= 3 ? sx() : Math.max(sx(), x - 30), b = spawn('ptbreath', left, y - h / 2, '', 1400); b.style.width = lv(l, 340, Math.round(vw() * .5), vw()) + 'px'; b.style.height = h + 'px'; if (l >= 2) fx.scorch(el, lv(l, 1, 2, 3)); if (l >= 3) fx.quake(); },
      sparks: (el, l) => { const [x, y] = center(el), n = lv(l, 10, 20, 30), d = lv(l, .5, .8, 1); for (let i = 0; i < n; i++) { const e = spawn('ptstreak', x, y, '', 900); e.style.setProperty('--a', (i / n * 360 + rr(-6, 6)) + 'deg'); e.style.setProperty('--d', rr(120, 340) * d + 'px'); e.style.animationDelay = rr(0, 120) + 'ms'; } if (l >= 3) { fx.flash(); fx.quake(); } },
      embers: (el, l) => { const [x, y] = center(el), n = lv(l, 8, 16, 28), sp = lv(l, 100, 170, 240); for (let i = 0; i < n; i++) { const e = spawn('ptember', x + rr(-sp, sp), y + rr(-30, 170), '', 1500); e.style.setProperty('--r', Math.random()); e.style.animationDelay = rr(0, 520) + 'ms'; } if (l >= 2) fx.scorch(el, 2); },
      // ===== branco
      divine: (el, l) => { const [x, y] = center(el), top = sy(), w = lv(l, 70, 130, 180), b = spawn('ptdivine', x - w / 2, top, '', 1700); b.style.width = w + 'px'; b.style.height = Math.max(90, y - top + 40) + 'px';
        if (l >= 2) { const s = lv(l, 0, 220, 300); spawn('ptrays', x - s / 2, y - s / 2, '', 1500).style.width = s + 'px'; } if (l >= 3) fx.flash(true); once(el, 'fx-gold', 1300);
        for (let i = 0; i < lv(l, 3, 6, 8); i++) later(() => spawn('ptspark', x + rr(-70, 70), y + rr(-90, 60), '', 900), i * 80); },
      sunburst: (el, l) => { const [x, y] = center(el), s = lv(l, 260, 520, 900), r = spawn('ptrays big', x - s / 2, y - s / 2, '', 1700); r.style.width = r.style.height = s + 'px'; if (l >= 3) fx.flash(true); once(el, 'fx-gold', 1300); },
      feathers: (el, l) => { const [x, y] = center(el), y0 = l >= 3 ? sy() - 30 : y - 170, n = lv(l, 6, 12, 18), r = lv(l, 110, 220, 320); parts(x, y0, n, () => ['feather', FEATHER, { x: rr(-r, r), dx: rr(-60, 60), dy: (y - y0) + rr(20, 160), rot: rr(-220, 220), s: rr(.8, 1.2), dur: rr(1500, 2300), delay: rr(0, 500), w: rr(20, 34), h: rr(34, 54) }]); if (l >= 3) fx.flash(true); },
      dome: (el, l) => { const [x, y] = center(el), s = lv(l, 150, 240, 340), d = spawn('ptdome', x - s / 2, y - s / 2, '', 1600); d.style.width = d.style.height = s + 'px'; if (l >= 3) fx.flash(true); },
      halo: (el, l) => { const [x, y] = center(el), w = lv(l, 120, 150, 180), h = spawn('pthalo', x - w / 2, y - cardH(el) / 2 - 46, '', 1600); h.style.width = w + 'px'; h.style.height = w * .29 + 'px'; once(el, 'fx-gold', 1300); if (l >= 3) fx.flash(true); },
      // ===== azul
      tide: (el, l) => { const [x, y] = center(el); for (let i = 0; i < lv(l, 3, 4, 3); i++) { const r = spawn('ptripple', x, y, '', 1100); r.style.animationDelay = (i * 160) + 'ms'; }
        if (l === 2) parts(x, y + cardH(el) / 2, 8, () => ['bub', '', { x: rr(-120, 120), dx: rr(-20, 20), dy: -rr(80, 200), dur: rr(1200, 1800), delay: rr(0, 400), w: rr(10, 26) }]);
        if (l >= 3) { overlay('ptwave', 2700, '<i class="w1"></i><i class="w2"></i>'); if (Math.random() < .55) fx.gag('underwater', el); } },
      whirlpool: (el, l) => { const [x, y] = center(el), s = lv(l, 170, 230, 300); let d = 'M0 0'; for (let t = 0; t < 22; t += .4) d += ` L${(Math.cos(t) * t * 6).toFixed(1)} ${(Math.sin(t) * t * 6).toFixed(1)}`;
        const w = spawn('ptwhirl', x - s / 2, y - s / 2, `<svg width="${s}" height="${s}" viewBox="-150 -150 300 300"><path d="${d}" fill="none" stroke="rgba(120,200,255,.95)" stroke-width="6" stroke-linecap="round"/></svg>`, 1500); w.style.width = w.style.height = s + 'px';
        for (let i = 0; i < lv(l, 0, 2, 3); i++) { const r = spawn('ptripple', x, y, '', 1100); r.style.animationDelay = (i * 160) + 'ms'; } },
      mist: (el, l) => { const [x, y] = center(el), n = lv(l, 2, 4, 8); for (let i = 0; i < n; i++) { const m = spawn('ptmist', l >= 3 ? sx() - 200 : x - 160, y + rr(-lv(l, 40, 80, 130), lv(l, 40, 80, 130)), '', 2300); m.style.width = rr(200, 360) * lv(l, .6, .85, 1.1) + 'px'; m.style.height = rr(90, 160) * lv(l, .6, .85, 1.1) + 'px'; m.style.animationDelay = rr(0, 500) + 'ms'; m.style.setProperty('--to', lv(l, 220, 420, vw() + 500) + 'px'); } },
      jelly: (el, l) => { fx.shake(el); if (l === 2) { const [x, y] = center(el); for (let i = 0; i < 2; i++) { const r = spawn('ptripple', x, y, '', 1000); r.style.animationDelay = (i * 150) + 'ms'; } } if (l >= 3) fx.gag('jelly', el); },
      bubbles: (el, l) => { const [x, y] = center(el), n = lv(l, 6, 12, 20); if (l >= 3) parts(sx(), sy() + vh() + 20, n, () => ['bub', '', { x: rr(0, vw()), dx: rr(-40, 40), dy: -rr(vh() * .5, vh() * 1.05), s: rr(.9, 1.4), dur: rr(1700, 2600), delay: rr(0, 600), w: rr(12, 46) }]);
        else parts(x, y + cardH(el) / 2, n, () => ['bub', '', { x: rr(-lv(l, 60, 140, 0), lv(l, 60, 140, 0)), dx: rr(-20, 20), dy: -rr(lv(l, 90, 160, 0), lv(l, 190, 300, 0)), s: rr(.9, 1.3), dur: rr(1200, 1900), delay: rr(0, 500), w: rr(10, lv(l, 22, 32, 0)) }]); },
      frost: (el, l) => { if (l >= 3) return E.ice(el, 3); once(el, 'fx-frozen', lv(l, 1500, 1900, 2300)); const [x, y] = center(el); for (let i = 0; i < lv(l, 5, 6, 0); i++) { const s = spawn('ptsnow', x + rr(-60, 60), y - cardH(el) / 3, '', 1500); s.style.animationDelay = (i * 80) + 'ms'; }
        if (l === 2) for (let i = 0; i < 4; i++) { const sh = spawn('ptshard', x + rr(-90, 90), y + cardH(el) / 2 - 60, '', 1800); sh.style.height = rr(50, 90) + 'px'; sh.style.width = '34px'; sh.style.animationDelay = (i * 80) + 'ms'; } },
      rain: (el, l) => { if (l >= 3) return E.storm(el, 3); const [x, y] = center(el), n = lv(l, 16, 34, 0), r = lv(l, 70, 150, 0), y0 = y - lv(l, 180, 260, 0);   // chuvinha local (Brainstorm = só uma chuvinha)
        parts(x, y0, n, () => ['rdrop', '', { x: rr(-r, r), dy: (y - y0) + rr(0, 40), dur: rr(500, 800), delay: rr(0, 800), w: 2, h: 18 }]); },
      // ===== preto
      void: (el, l) => { const [x, y] = center(el), s = lv(l, 110, 170, 220), v = spawn('ptvoid', x - s / 2, y - s / 2, '', 1500); v.style.width = v.style.height = s + 'px'; if (l >= 3) overlay('ptdim', 1700); },
      hole: (el, l) => { E.void(el, l); if (l >= 3) fx.gag('hole', el); },
      tendrils: (el, l) => { const [x, y] = center(el), w = vw(), h = vh(), W = el.offsetWidth || 120;
        const path = (cx, cy, ax, ay, f) => { const l2 = rr(.28, .5) * f, x1 = cx + ax * w * l2 * rr(.5, 1), y1 = cy + ay * h * rr(.1, .4), x2 = cx + ax * w * l2, y2 = cy + ay * h * l2 * rr(.6, 1.1); return `<path d="M${cx} ${cy} C${x1.toFixed(0)} ${y1.toFixed(0)} ${(x2 * .6 + cx * .4 + rr(-40, 40)).toFixed(0)} ${(y2 * .6 + cy * .4 + rr(-40, 40)).toFixed(0)} ${x2.toFixed(0)} ${y2.toFixed(0)}" fill="none" stroke="#0b0214" stroke-width="${rr(8, 18).toFixed(0)}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".7s" begin="${rr(0, .2).toFixed(2)}s" fill="freeze"/></path>`; };
        if (l <= 1) { let d = ''; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, r0 = W / 2; d += `<path d="M${(160 + Math.cos(a) * r0).toFixed(0)} ${(160 + Math.sin(a) * r0 * 1.2).toFixed(0)} q${(Math.cos(a) * 60 + rr(-25, 25)).toFixed(0)} ${(Math.sin(a) * 60 + rr(-25, 25)).toFixed(0)} ${(Math.cos(a) * 95).toFixed(0)} ${(Math.sin(a) * 95).toFixed(0)}" fill="none" stroke="#0b0214" stroke-width="9" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".6s" fill="freeze"/></path>`; }
          spawn('pttendl', x - 160, y - 160, `<svg width="320" height="320" viewBox="0 0 320 320" style="filter:drop-shadow(0 0 8px #7a2cff)">${d}</svg>`, 1500); return; }
        const corners = [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]].filter((c, i) => l >= 3 || i < 2); let d = ''; corners.forEach(([cx, cy, ax, ay]) => { for (let i = 0; i < lv(l, 1, 2, 3); i++) d += path(cx, cy, ax, ay, lv(l, .6, .8, 1)); });
        overlay('pttend', 2000, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="filter:drop-shadow(0 0 12px #7a2cff)">${d}</svg>`); },
      ink: (el, l) => { const [x, y] = center(el), n = lv(l, 5, 9, 16), r = lv(l, 60, 120, vw() / 2); for (let i = 0; i < n; i++) { const e = spawn('ptink', l >= 3 ? sx() + rr(0, vw()) : x + rr(-r, r), l >= 3 ? sy() - 8 : y - cardH(el) / 2 - 8, '', 1900); e.style.width = rr(12, lv(l, 18, 24, 30)) + 'px'; e.style.setProperty('--len', rr(lv(l, 50, 90, 120), lv(l, 120, 190, 320)) + 'px'); e.style.animationDelay = rr(0, 500) + 'ms'; } if (l >= 3) overlay('ptdim light', 1400); },
      bats: (el, l) => { const [x, y] = center(el), n = lv(l, 2, 4, 9), run = lv(l, 520, 820, vw() + 160); for (let i = 0; i < n; i++) later(() => { const ltr = Math.random() < .5, sz = rr(34, lv(l, 48, 60, 84)), e = spawn('ptrun ' + (ltr ? 'ltr' : 'rtl') + ' bat', l >= 3 ? sx() + (ltr ? -80 : vw() + 20) : x + (ltr ? -run / 2 : run / 2), l >= 3 ? sy() + rr(40, vh() - 40) : y + rr(-90, 90), BAT, 2200); e.style.width = sz + 'px'; e.style.height = sz * .6 + 'px'; e.style.setProperty('--w', run + 'px'); e.style.animationDuration = rr(1.1, 1.9) + 's'; }, i * 110); },
      web: (el, l) => { const w = lv(l, 110, 170, 230), web = `<g stroke="#dfe4ee" stroke-width="1.4" fill="none" opacity=".9">${[0, 18, 36, 54, 72, 90].map(a => `<path d="M0 0L${(Math.cos(a * Math.PI / 180) * w).toFixed(0)} ${(Math.sin(a * Math.PI / 180) * w).toFixed(0)}"/>`).join('')}${[.18, .36, .54, .72, .9].map(r => `<path d="M${(r * w).toFixed(0)} 0Q${(r * w * .75).toFixed(0)} ${(r * w * .75).toFixed(0)} 0 ${(r * w).toFixed(0)}"/>`).join('')}</g>`;
        const spots = [['left:0;top:0', ''], ['right:0;top:0', 'transform:scaleX(-1)'], ['left:0;bottom:0', 'transform:scaleY(-1)'], ['right:0;bottom:0', 'transform:scale(-1,-1)']].filter((c, i) => l >= 3 || (l === 2 && i < 2));
        if (l <= 1) { const [x, y] = center(el); spawn('ptwebl', x - (el.offsetWidth || 120) / 2, y - cardH(el) / 2, `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}">${web}</svg>`, 1700); return; }
        overlay('ptwebs', 2000, spots.map(([pos, tr]) => `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" style="position:absolute;${pos};${tr}">${web}</svg>`).join('')); },
      wither: (el, l) => { once(el, 'fx-ghost', 2100); if (l >= 2) { const [x, y] = center(el); for (let i = 0; i < lv(l, 0, 5, 0); i++) spawn('ptpuff', x + rr(-50, 50), y + rr(-50, 50), '', 800); } if (l >= 3) { document.body.classList.add('pt-gray'); setTimeout(() => document.body.classList.remove('pt-gray'), 1500); overlay('ptdim', 1600); } },
      // ===== verde
      vines: (el, l) => { const [x, y] = center(el), cardBottom = y + cardH(el) / 2 + 10, bottom = l >= 3 ? sy() + vh() : cardBottom, h = l >= 3 ? Math.max(120, bottom - y + 60) : lv(l, 190, 300, 0), w = 260, nv = lv(l, 1, 2, 3), nl = lv(l, 5, 8, 14);
        for (let v = 0; v < nv; v++) { const x0 = w / 2 + (nv === 1 ? 0 : (v - (nv - 1) / 2) * 70), pts = []; for (let i = 0; i <= 8; i++) pts.push([x0 + Math.sin(i * 1.3 + v) * 34, h - i * h / 8]);
          const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join(' ');
          const leaves = pts.filter((_, i) => i % 2 === 1).map((p, i) => `<g transform="translate(${p[0].toFixed(0)} ${p[1].toFixed(0)}) rotate(${i % 2 ? 50 : -50})"><g><animateTransform attributeName="transform" type="scale" from="0" to="1" begin="${(.25 + i * .12).toFixed(2)}s" dur=".25s" fill="freeze"/><g transform="translate(-12 -22)">${LEAF(['#4caf50', '#7bc043', '#2e8b57'][i % 3])}</g></g></g>`).join('');
          spawn('ptvine', x - w / 2, bottom - h, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#3b8a2f" stroke-width="6" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".7s" begin="${(v * .08).toFixed(2)}s" fill="freeze"/></path>${leaves}</svg>`, 1700); }
        for (let i = 0; i < nl; i++) { const lf = spawn('ptleaf', x, y, LEAF(['#4caf50', '#8bc34a', '#2e7d32', '#aed581'][i % 4]), 1500), a = rr(0, Math.PI * 2), d = rr(70, lv(l, 120, 180, 260)); lf.style.setProperty('--lx', Math.cos(a) * d + 'px'); lf.style.setProperty('--ly', Math.sin(a) * d - 40 + 'px'); lf.style.setProperty('--lr', rr(-540, 540) + 'deg'); lf.style.animationDelay = rr(0, 260) + 'ms'; } },
      leafstorm: (el, l) => { const [x, y] = center(el), n = lv(l, 8, 16, 34), loc = l < 3; parts(loc ? x - 230 : sx() - 30, loc ? y - 60 : sy(), n, () => ['leafp', LEAF(['#4caf50', '#8bc34a', '#2e7d32', '#aed581'][Math.floor(Math.random() * 4)]), { y: loc ? rr(-60, 120) : rr(30, vh() - 30), dx: loc ? lv(l, 460, 640, 0) : vw() + 80, dy: rr(-120, 120), rot: rr(-700, 700), s: rr(.9, 1.3), dur: rr(1200, 1900), delay: rr(0, 450), w: rr(22, 38) }]); },
      spores: (el, l) => { const [x, y] = center(el), n = lv(l, 8, 16, 26), loc = l < 3, r = lv(l, 90, 190, 0); parts(loc ? x : sx(), loc ? y + 20 : sy() + vh() * .5, n, () => ['spore', '', { x: loc ? rr(-r, r) : rr(0, vw()), y: rr(0, loc ? 90 : vh() * .5), dx: rr(-50, 50), dy: -rr(120, loc ? 240 : 360), s: rr(.8, 1.5), dur: rr(1500, 2300), delay: rr(0, 500), w: rr(8, 16) }]); },
      petals: (el, l) => { const [x, y] = center(el), n = lv(l, 8, 16, 30), loc = l < 3, r = lv(l, 90, 190, 0); parts(loc ? x : sx(), loc ? y - 220 : sy() - 20, n, () => ['petal', PETAL(['#ffb7c5', '#ffd6e0', '#ff8fab', '#fff0f3'][Math.floor(Math.random() * 4)]), { x: loc ? rr(-r, r) : rr(0, vw()), dx: rr(-100, 100), dy: loc ? lv(l, 260, 360, 0) : vh() + 60, rot: rr(-500, 500), s: 1, dur: rr(1700, 2600), delay: rr(0, 600), w: rr(14, 26) }]); },
      roots: (el, l) => { const [x, y] = center(el), n = lv(l, 3, 5, 7), f = lv(l, .45, .7, 1); let svg = ''; for (let i = 0; i < n; i++) { let px = 0, py = 0, a = i / n * Math.PI * 2 + rr(-.3, .3), d = ''; for (let k = 0; k < 7; k++) { a += rr(-.6, .6); px += Math.cos(a) * rr(35, 65) * f; py += Math.sin(a) * rr(35, 65) * f; d += ` L${px.toFixed(0)} ${py.toFixed(0)}`; } svg += `<path d="M0 0${d}" fill="none" stroke="#5b3a1a" stroke-width="${rr(3, lv(l, 5, 6, 8)).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur=".7s" fill="freeze"/></path>`; }
        spawn('ptcrack', x - 420, y - 420, `<svg width="840" height="840" viewBox="-420 -420 840 840">${svg}</svg>`, 3600000); if (l >= 3) fx.quake(); },
      grass: (el, l) => { const [x, y] = center(el), n = lv(l, 12, 24, 46), span = lv(l, 160, 340, vw()), base = l >= 3 ? sy() + vh() + 4 : y + cardH(el) / 2 + 2; for (let i = 0; i < n; i++) { const left = l >= 3 ? sx() + i * vw() / (n - 1) + rr(-8, 8) : x + (i / (n - 1) - .5) * span; const g = spawn('ptgrass', left, base, '', 2000); g.style.height = rr(40, lv(l, 80, 110, 170)) + 'px'; g.style.animationDelay = rr(0, 300) + 'ms'; g.style.setProperty('--sway', rr(-14, 14) + 'deg'); } },
      // ===== incolor
      metal: (el, l) => { fx.sheen(el); const [x, y] = center(el); for (let i = 0; i < lv(l, 0, 1, 3); i++) { const r = spawn('ptripple force', x, y, '', 900); r.style.animationDelay = (i * 120) + 'ms'; r.style.borderColor = 'rgba(210,220,235,.95)'; } if (l >= 3) fx.quake(); },
      gears: (el, l) => { const [x, y] = center(el), w = el.offsetWidth || 120, h = cardH(el); [[-1, -1], [1, -1], [-1, 1], [1, 1]].slice(0, lv(l, 2, 4, 4)).forEach(([a, b], k) => parts(x + a * w / 2, y + b * h / 2, 1, () => ['gear', GEAR, { x: -22, y: -22, dx: a * 30, dy: b * 30, rot: 360 * (k % 2 ? 1 : -1), s: 1.2, dur: 1500, w: rr(30, lv(l, 40, 46, 56)) }])); if (l >= 2) fx.sheen(el); },
      laser: (el, l) => { const [x, y] = center(el); if (l <= 1) { spawn('ptlaserl h', x - 120, y, '', 700); spawn('ptlaserl v', x, y - 140, '', 700); return; }
        const h = spawn('ptlaser h', sx(), sy(), '', 1000), v = spawn('ptlaser v', sx(), sy(), '', 1000); h.style.setProperty('--to', vh() + 'px'); v.style.setProperty('--to', vw() + 'px'); fx.sheen(el); if (l >= 3) { fx.flash(); later(() => spawn('ptripple force', x, y, '', 800), 300); } },
      // ===== extras globais pelo título (só do nível 2 para cima; os de página inteira só no nível 3)
      earth: (el, l) => { fx.crater(el, l >= 3); if (l >= 3) { fx.quake(); if (Math.random() < .4) fx.gag('gravity', el); } const [x, y] = center(el), h = cardH(el); for (let i = 0; i < lv(l, 0, 5, 7); i++) { const p = spawn('ptpuff dust', x + rr(-60, 60), y + h / 2 - 6, '', 800); p.style.animationDelay = (i * 40) + 'ms'; } },
      ice: (el, l) => { if (l < 3) return E.frost(el, l); overlay('ptfrost', 2300); const vwv = vw(), vhv = vh(); for (let i = 0; i < 12; i++) { const top = i % 2 === 1, h = rr(80, 190), s = spawn('ptshard' + (top ? ' top' : ''), sx() + rr(0, vwv), sy() + (top ? -6 : vhv - h + 6), '', 2200); s.style.height = h + 'px'; s.style.animationDelay = rr(0, 300) + 'ms'; } once(el, 'fx-frozen', 2300); },
      wind: (el, l) => { if (l >= 3) fx.gag(Math.random() < .5 ? 'float' : 'barrel', el); },
      time: (el, l) => { if (l >= 3) { document.body.classList.add('pt-gray'); setTimeout(() => document.body.classList.remove('pt-gray'), 1000); } const [x, y] = center(el); spawn('ptclock', x - 44, y - 44, '<svg viewBox="0 0 88 88" width="88" height="88"><circle cx="44" cy="44" r="40" fill="rgba(20,20,30,.55)" stroke="#fff" stroke-width="4"/><path d="M44 44V18" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M44 44L62 52" stroke="#ffd34d" stroke-width="4" stroke-linecap="round"/></svg>', 1100); },
      party: (el, l) => { if (l >= 3) fx.gag('disco', el); for (let i = 0; i < lv(l, 0, 14, 28); i++) { const e = spawn('ptconf', l >= 3 ? sx() + rr(0, vw()) : center(el)[0] + rr(-160, 160), l >= 3 ? sy() - 10 : center(el)[1] - 220, '', 2200); e.style.background = ['#ff5a5a', '#ffd34d', '#5ac8ff', '#7be07b', '#c77bff'][i % 5]; e.style.animationDelay = rr(0, .7) + 's'; } },
      mirror: (el, l) => { if (l >= 3 && Math.random() < .6) fx.gag('mirrorpage', el); const c = el.cloneNode(true); c.classList.add('fx-mirror'); c.style.pointerEvents = 'none'; c.removeAttribute('data-pid'); document.body.appendChild(c); setTimeout(() => c.remove(), 1100); },
      zerg: (el, l) => { const colors = ['#ea4335', '#fbbc05', '#34a853', '#4285f4'], n = lv(l, 0, 14, 46); for (let i = 0; i < n; i++) later(() => { const ltr = Math.random() < .5, e = spawn('ptrun ' + (ltr ? 'ltr' : 'rtl') + ' zerg', sx() + (ltr ? -40 : vw() + 10), sy() + rr(40, vh() - 40), '', 2300), s = rr(14, 34); e.style.width = e.style.height = s + 'px'; e.style.background = colors[i % 4]; e.style.setProperty('--w', vw() + 80 + 'px'); e.style.animationDuration = rr(1.2, 2.2) + 's'; }, i * 45); },
      force: (el, l) => { const [x, y] = center(el), r = spawn('ptripple force', x, y, '', 900); r.style.animationDuration = '.8s'; if (l >= 3) fx.gag('blast', el);   // repele as letras da página
        document.querySelectorAll('.ptcard:not(.ghost)').forEach(c => { if (c === el) return; const [cx, cy] = center(c), dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1; c.style.setProperty('--px', (dx / d * 46).toFixed(0) + 'px'); c.style.setProperty('--py', (dy / d * 46).toFixed(0) + 'px'); once(c, 'fx-push', 700); }); },
      steam: (el, l) => { const [x, y] = center(el), h = cardH(el); for (let i = 0; i < lv(l, 0, 5, 7); i++) { const p = spawn('ptpuff steam', x + rr(-50, 50), y + h / 3, '', 1300); p.style.animationDelay = (i * 90) + 'ms'; } },
      slash: (el, l) => { const [x, y] = center(el); spawn('ptslash', x - 170, y - 3, '', 700); once(el, 'fx-shake', 520); },
      rage: (el, l) => { if (l >= 3) { overlay('ptrage', 1500); fx.quake(); } else once(el, 'fx-shake', 520); },
      ghost: el => once(el, 'fx-ghost', 2100),
      rainbow: el => once(el, 'fx-rainbow', 1700),
      storm: (el, l) => { if (l < 3) return E.rain(el, l); const o = overlay('ptrain', 3100); for (let i = 0; i < 70; i++) { const d = document.createElement('i'); d.style.left = rr(0, 100) + '%'; d.style.animationDelay = rr(0, 1.6) + 's'; d.style.animationDuration = rr(.45, .8) + 's'; d.style.height = rr(14, 30) + 'px'; o.appendChild(d); } later(() => { fx.flash(); fx.quake(); }, 350); },
    };
    /** Jogou a carta: assinatura da cor (ou do título) + no máximo um extra do título. */
    fx.play = (key, el, l) => E[key] && (E[key](el, l || 3), true);   // dispara uma variação pelo nome e nível (testes)
    /** Nível pelo custo de mana: 0-2 = 1 (sutil), 3-4 = 2 (médio), 5+ = 3 (a tela toda). */
    fx.level = cmc => (cmc >= 5 ? 3 : cmc >= 3 ? 2 : 1);
    /** Jogou a carta: assinatura da cor (ou do título) + um extra do título (só a partir do nível 2). Cartas baratas ficam sutis para dar para continuar testando. */
    fx.cast = (name, colors, el, cmc) => { const l = fx.level(cmc || 0); castKeys(name, colors).forEach((k, i) => { if (i === 1 && l < 2) return; later(() => E[k] && E[k](el, l), i * 280); }); };

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

  return { analyze, hitByWrath, titleKeys, castKeys, landKey, landScore, colorOfType, BASICS, POOLS, hash, fx, level: cmc => (cmc >= 5 ? 3 : cmc >= 3 ? 2 : 1) };
});
