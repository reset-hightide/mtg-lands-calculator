/*
 * Efeitos engraçados do playtest. Tudo é decidido pelo texto de regras e pelo tipo da carta (nunca pelo nome), então
 * cartas novas ganham o efeito sozinhas. Sem narração: só animação.
 * PtFx.analyze(cartaScryfall) -> perfil (puro, testável); PtFx.fx.* -> animações em elementos .ptcard.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.PtFx = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
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
   * Perfil de efeitos da carta. Campos: land, spell, creature, planeswalker, artifact, enchantment, haste, fetch, tapMana,
   * wrath { kinds }, damage N, target ('counter'|'destroy'|'exile'|'bounce'|'tap'), draw N, ramp { table, hand },
   * alt { kind: 'sacrifice'|'exile-hand'|'return', type|color, n } (custo alternativo "rather than pay").
   */
  function analyze(card) {
    const t = oracleOf(card).toLowerCase(), type = frontOf(card).type_line || card.type_line || '';
    const p = {
      type, land: /\bland\b/i.test(type), spell: /\b(instant|sorcery)\b/i.test(type), creature: /\bcreature\b/i.test(type),
      planeswalker: /\bplaneswalker\b/i.test(type), artifact: /\bartifact\b/i.test(type), enchantment: /\benchantment\b/i.test(type),
      haste: /\bhaste\b/.test(t), colors: card.colors || (frontOf(card).colors) || [],
      fetch: false, tapMana: false, wrath: null, damage: 0, target: null, draw: 0, ramp: null, alt: null,
    };
    // terreno que se sacrifica para buscar outro terreno (fetch land, Evolving Wilds...)
    p.fetch = p.land && /sacrifice/.test(t) && /search your library for an? [^.]*? card/.test(t);
    // vira por mana: criatura/artefato/terreno com "{T}: Add"
    p.tapMana = (card.produced_mana || []).length > 0 && /\{t\}/.test(t) && /\badd\b/.test(t);
    if (p.land && (card.produced_mana || []).length) p.tapMana = true;
    if (p.land) return p;

    // destrua/exile todos: varre a mesa
    const kinds = [];
    for (const w of t.matchAll(/(?:destroy|exile) all ([a-z ]+?)(?:[.,;]| and | that | you | with | of | except |$)/g)) {
      const n = w[1];
      const k = /nonland permanent/.test(n) ? '!Land' : /permanent/.test(n) ? '*' : /creature/.test(n) ? 'Creature' : /artifact/.test(n) ? 'Artifact' : /enchantment/.test(n) ? 'Enchantment' : /planeswalker/.test(n) ? 'Planeswalker' : /land/.test(n) ? 'Land' : null;
      if (k && !kinds.includes(k)) kinds.push(k);
    }
    if (kinds.length) p.wrath = { kinds };
    // efeito sobre outra carta da mesa (jogue por cima dela)
    if (/counter target/.test(t)) p.target = 'counter';
    else if (/destroy target/.test(t)) p.target = 'destroy';
    else if (/exile target/.test(t)) p.target = 'exile';
    else if (/return target [^.]*?to (?:its|their) owner'?s? hand/.test(t)) p.target = 'bounce';
    else if (/\btap target/.test(t)) p.target = 'tap';
    const d = t.match(/deals? (\d+|x) damage to (?:any target|target|each target)/);
    if (d) p.damage = /^\d+$/.test(d[1]) ? +d[1] : 3;
    // compra (só mágica instantânea/feitiço, para não disparar com criatura que compra ao entrar)
    const dr = p.spell && t.match(/draws? (a|an|one|two|three|four|five|\d+) cards?/);
    if (dr) p.draw = Math.min(4, num(dr[1]));
    // busca terreno básico
    if (p.spell && /search your library for [^.]*?(?:basic )?land card/.test(t)) {
      const table = /put one onto the battlefield/.test(t) ? 1 : /onto the battlefield/.test(t) ? (/up to two|two basic|put (?:them|both|those)/.test(t) ? 2 : 1) : 0;
      const hand = /into your hand/.test(t) ? 1 : 0;
      if (table || hand) p.ramp = { table, hand };
    }
    // custo alternativo que tira algo de você (free spells)
    let m;
    if ((m = t.match(/sacrifice (a|an|one|two|three|\d+) (plains|islands?|swamps?|mountains?|forests?) rather than pay/))) p.alt = { kind: 'sacrifice', type: LAND_TYPES[m[2]], n: num(m[1]) };
    else if ((m = t.match(/exile (a|an|one|two) (white|blue|black|red|green) cards? from your hand rather than pay/))) p.alt = { kind: 'exile-hand', color: COLOR_LETTER[m[2]], n: num(m[1]) };
    else if ((m = t.match(/return (an?|one|two) (plains|islands?|swamps?|mountains?|forests?) you control to (?:its|their) owner'?s? hand rather than pay/))) p.alt = { kind: 'return', type: LAND_TYPES[m[2]], n: num(m[1]) };
    return p;
  }

  /** A carta (perfil) é alcançada por um "destrua todos" desse tipo? */
  function hitByWrath(kinds, prof) {
    return kinds.some(k => k === '*' || (k === '!Land' ? !prof.land : new RegExp('\\b' + k + '\\b', 'i').test(prof.type)));
  }


  // ------------------------------------------------------------------ lógica dos títulos (palavras do nome, nunca uma lista de cartas)
  /** Bichos: palavra no título -> emoji que corre pela tela. */
  const CRITTERS = [
    [/\b(dragon|drake|wyrm)/, '🐉'], [/\b(hydra)/, '🐲'], [/\b(kraken|octopus|squid)/, '🐙'], [/\b(whale|leviathan)/, '🐋'], [/\bshark/, '🦈'], [/\b(fish|eel|salmon)/, '🐟'],
    [/\b(cat|cats|lion|panther|sphinx|feline|leonin)\b|\blion/, '🐈'], [/\btiger/, '🐅'], [/\b(wolf|wolves|werewolf)/, '🐺'], [/\bbear/, '🐻'], [/\b(dog|hound|jackal)/, '🐕'],
    [/\b(bird|hawk|eagle|crow|raven|falcon|roc\b|phoenix)/, '🦅'], [/\bowl/, '🦉'], [/\b(snake|serpent|basilisk|cobra|viper)/, '🐍'], [/\bspider/, '🕷️'], [/\bbat\b|\bbats\b/, '🦇'],
    [/\b(rat|rats|mouse|mice)\b/, '🐀'], [/\b(horse|unicorn|pegasus|steed)/, '🐴'], [/\b(boar|pig|swine)/, '🐗'], [/\belephant|mammoth/, '🐘'], [/\b(ape|monkey|primate)\b/, '🐒'],
    [/\b(frog|toad)/, '🐸'], [/\b(beetle|ant|ants|bee|bees|wasp|insect|hornet)\b/, '🐝'], [/\b(butterfly|moth)/, '🦋'], [/\bturtle|tortoise/, '🐢'], [/\bcrab/, '🦀'], [/\bscorpion/, '🦂'],
    [/\b(deer|elk|stag)\b/, '🦌'], [/\b(rabbit|hare)\b/, '🐇'], [/\bfox/, '🦊'], [/\bgoat/, '🐐'], [/\b(bull|ox|cow|minotaur)\b/, '🐂'], [/\bdinosaur|raptor|rex\b/, '🦖'], [/\bsnail/, '🐌'],
    [/\b(angel|seraph|archangel)/, '😇'], [/\b(demon|devil|imp\b|fiend)/, '😈'], [/\bgoblin/, '👺'], [/\b(ogre|orc|troll)/, '👹'], [/\bzombie/, '🧟'], [/\bvampire/, '🧛'], [/\belf\b|\belves\b|\belvish/, '🧝'],
    [/\b(fairy|faerie|pixie|sprite|fae)\b/, '🧚'], [/\b(wizard|mage|sorcerer|warlock|witch)/, '🧙'], [/\b(merfolk|mermaid|siren)/, '🧜'], [/\bgenie|djinn/, '🧞'], [/\balien|eldrazi/, '👽'], [/\bskeleton/, '💀'],
  ];
  /** Regras por palavra do título (na ordem de prioridade). Cada chave é um efeito. */
  const TITLE_RULES = [
    ['bolt', /\b(lightning|thunder|bolt|shock|zap|spark|volt|electr|jolt|galvan|static)/],
    ['meteor', /\b(meteor|comet|asteroid|armageddon|apocalypse|annihilat|obliterat|extinction|cataclysm|doomsday|impact)/],
    ['critter', null],
    ['fire', /\b(fire|flame|burn(?!ish)|inferno|blaze|pyre|ember|scorch|scald|char\b|magma|lava|immolat|incinerat|sear\b|ignit|explo|hellfire|torch|kindle|flare|conflagrat|brimstone|smolder|cinder|volcan)/],
    ['water', /\b(water|tide|tidal|wave|flood|deluge|tsunami|aqua|sea\b|ocean|river|drown|lake|splash|bubble|current|whirlpool|torrent|cascade|surge|rain|drench|soak|geyser|fountain|spring\b)/],
    ['storm', /(storm|hurricane|tempest|monsoon)/],   // sem \b: Brainstorm, Firestorm, Snowstorm também
    ['ice', /\b(frost|ice\b|icy|freez|frozen|glacier|blizzard|winter|snow|chill|hail|arctic|tundra|permafrost|cold|sleet)/],
    ['wind', /\b(drift|float|flutter|soar|glide|wind|gust|tornado|cyclone|whirl|gale|breeze|zephyr|updraft|squall|air\b|sky|cloud|vortex|twister)/],
    ['earth', /\b(earthquake|quake|tremor|avalanche|landslide|boulder|rockslide|stomp|colossal|titan|behemoth|giant|stampede|trample|crush|smash|pummel|rubble|seism)/],
    ['dark', /\b(murk|crypt|tomb|coffin|sarcophag|catacomb|mausoleum|cemetery|skull|bone|shadow|dark|night|death|doom|grave|dread|nightmare|void|abyss|reaper|necro|lich|curse|hex\b|gloom|dusk|eclipse|midnight|sinister|ominous)/],
    ['light', /\b(gods?\b|smite|judg(?:e)?ment|verdict|retribution|sol\b|light up|lantern|lamp|candle|spotlight|beacon|glow|lumin|sun\b|sunlit|sunburst|dawn|holy|radiant|divine|glory|sacred|heaven|solar|celestial|aurora|halo|luminous|brilliant|shining|blessed)/],
    ['poison', /\b(poison|plague|toxic|venom|acid|rot\b|blight|decay|disease|pestilence|virulent|corrode|corrosion|sludge|ooze|slime|fume)/],
    ['time', /\b(time|stasis|hourglass|temporal|chrono|eternal|eternity|epoch|aeon|yesterday|tomorrow|timeless)/],
    ['slash', /\b(skewer|pierce|stab|impale|spear|lance|arrow|javelin|dart|fang|claw|talon|sword|blade|slash|dagger|axe\b|cleave|sever|rend\b|reave|slice|cut\b|knife|saber|scimitar|katana|razor|scythe|guillotine)/],
    ['crown', /\b(king|queen|emperor|empress|throne|crown|monarch|majesty|sovereign|regal|royal|overlord|prince|princess|tyrant)/],
    ['ghost', /\b(ghost|spirit|specter|spectre|wraith|phantom|banshee|haunt|apparition|poltergeist|wisp)/],
    ['coin', /\b(price|toll|tribute|bribe|cash|money|rich|bank|treasure|gold|coin|gem\b|jewel|diamond|crystal|wealth|riches|fortune|midas|pearl|ruby|sapphire|emerald|ingot|gilded|bounty)/],
    ['mind', /\b(mind|brain|think|thought|memory|psychic|telepath|wisdom|oracle|ponder|idea|insight|intellect|sage\b|scholar|genius|clever|cunning)/],
    ['heal', /\b(heal|cure\b|life\b|renew|restor|bless|nourish|rejuvenat|growth|bloom|harvest|seed|sprout|rebirth|resurrect|revive|vitality)/],
    ['music', /\b(song|dance|bard|choir|lullaby|melody|hymn|symphony|chant|serenade|ballad|opera|drum|trumpet|harmony|concert)/],
    ['ninja', /\b(secret|whisper|cipher|enigma|riddle|mystery|ninja|assassin|rogue|thief|bandit|spy\b|stealth|sneak|vanish|trickster|infiltrat|ambush|pickpocket|cutpurse)/],
    ['gear', /\b(golem|robot|construct|automaton|clockwork|machine|engine|gear|cog\b|myr\b|steel|iron|assembly|forge|mechan|thopter|cogwork)/],
    ['mirror', /\b(mirror|reflect|echo|twin|double|clone|copy|duplic|doppel|replicat|mimic|imitat)/],
    ['rainbow', /\b(rainbow|prism|chromatic|spectrum|kaleido|iridescent|color|colour)/],
    ['party', /\b(stage|theater|theatre|revel|party|fiesta|festival|celebrat|parade|carnival|circus|jester|clown|joke|fool|prank|revel)/],
    ['food', /\b(feast|food|bread|pie\b|apple|honey|cook|chef|meal|banquet|fruit|cake|pizza|soup|stew|candy|cookie)/],
    ['sleep', /\b(sleep|dream|slumber|lull|nap\b|drowsy|doze|hibernat)/],
    ['forest', /\b(cultivat|grow|farm|plant|orchard|forest|vine|wild|woods|jungle|thicket|briar|bramble|root\b|tree|leaf|leaves|spore|fungus|moss|garden|grove|overgrow|fern|thorn)/],
    ['rage', /\b(wrath|fury|furious|rage|anger|rampage|frenzy|berserk|tantrum)/],
    ['force', /\b(force|power|might|strength|push|shove|repel|shockwave|gravity|pressure)/],
    ['speed', /\b(swift|quick|fast|rush|sprint|haste|dash|flash|zoom|racer|rapid)/],
    ['steam', /(steam|vapor|smoke|\bmist|\bfog\b|haze|\bvent|exhale|boil)/],
    ['zerg', /\b(swarm|horde|zerg|army|legion|locust|infest|invasion|stampede|mob\b|flock|pack\b|brood|colony|hive)/],
    ['castle', /\b(tower|castle|fortress|citadel|keep\b|bastion|stronghold|palace|fort\b)/],
    ['counter', /\b(counter|negate|dispel|deny|cancel|stifle|forbid|prohibit|refuse|nullify|annul|veto|reject|remand)/],
  ];
  /** Até 2 efeitos para o título: [{ key, emoji? }]. Funciona com qualquer carta, inclusive as que ainda vão sair. */
  function titleKeys(name) {
    const n = String(name || '').split(' // ')[0].toLowerCase(), out = [];
    for (const [key, re] of TITLE_RULES) {
      if (out.length >= 2) break;
      if (key === 'critter') { const c = CRITTERS.find(x => x[0].test(n)); if (c) out.push({ key, emoji: c[1] }); continue; }
      if (re.test(n)) out.push({ key });
    }
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
    const once = (el, cls, ms) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
    const spawn = (cls, x, y, html, ms) => { const e = document.createElement('div'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px'; if (html) e.innerHTML = html; document.body.appendChild(e); setTimeout(() => e.remove(), ms || 900); return e; };
    const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 + root.scrollX, r.top + r.height / 2 + root.scrollY]; };
    fx.shake = el => once(el, 'fx-shake', 520);
    fx.burn = el => once(el, 'fx-burn', 700);
    fx.pop = el => once(el, 'fx-appear', 600);
    fx.sheen = el => once(el, 'fx-sheen', 1000);
    fx.gold = el => once(el, 'fx-gold', 1300);
    fx.haste = el => once(el, 'fx-haste', 600);
    fx.sparkle = el => { const [x, y] = center(el); for (let i = 0; i < 7; i++) setTimeout(() => spawn('ptspark', x + (Math.random() - .5) * el.offsetWidth * .9, y + (Math.random() - .5) * el.offsetHeight * .9, '✦', 800), i * 70); };
    fx.zzz = el => { const [x, y] = center(el); [0, 280, 560].forEach((d, i) => setTimeout(() => spawn('ptzzz', x + 14 + i * 12, y - el.offsetHeight / 2 + 10 - i * 8, '💤', 1100), d)); };
    fx.poof = el => { const [x, y] = center(el); for (let i = 0; i < 6; i++) spawn('ptpuff', x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60, '', 700); };
    fx.float = (el, text) => { const [x, y] = center(el); spawn('ptfloat', x, y - 20, text, 1000); };
    fx.flash = () => spawn('ptflash', 0, 0, '', 320);
    /** Chamusca a página: marca de queimado (fica até o fim do playtest), brasas subindo e brilho que esfria. Cresce com o dano. */
    fx.scorch = (el, dmg) => {
      const [x, y] = center(el), size = 90 + Math.min(10, dmg || 2) * 22;
      const s = spawn('ptscorch', x - size / 2, y - size / 2, '', 3600000); s.style.width = s.style.height = size + 'px';
      s.style.borderRadius = `${44 + Math.random() * 12}% ${44 + Math.random() * 12}% ${44 + Math.random() * 12}% ${44 + Math.random() * 12}% / ${44 + Math.random() * 12}% ${44 + Math.random() * 12}% ${44 + Math.random() * 12}% ${44 + Math.random() * 12}%`;
      s.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
      for (let i = 0; i < 6; i++) setTimeout(() => spawn('ptember', x + (Math.random() - .5) * size * .7, y + (Math.random() - .5) * size * .4, '', 1300), i * 90);
    };
    fx.clear = () => { document.querySelectorAll('.ptscorch, .ptcrack, .ptcrater').forEach(e => e.remove()); if (fx.cancelGags) fx.cancelGags(); };

    // ---- gags estilo Google (Gravity, Barrel Roll, Underwater, Zerg Rush...): a página é a vítima, e tudo volta ao normal no fim
    let gagBusy = false, gagTimers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); gagTimers.push(t); return t; };
    const SKIP_TAG = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|SELECT|OPTION)$/;
    /** Fotografa as palavras visíveis da tela (letras, nos títulos grandes) e as devolve como espectros que podem cair, voar, ser sugados... */
    function collectWords(max) {
      const vw = root.innerWidth, vh = root.innerHeight, out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (!n.nodeValue.trim() || !n.parentElement || SKIP_TAG.test(n.parentElement.tagName) || n.parentElement.closest('.ptcard,.ptemo,.ptov,.ptgh-layer,#grimoire,#ptend,#ptmsg,.ptflash,.ptclock,.ptstamp,.ptcrown,.ptmana')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
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
    /** mode: 'gravity' (cai e empilha), 'float' (sobe), 'hole' (buraco negro), 'blast' (explode). (ox, oy) = origem em coordenadas da janela. */
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
    fx.crater = (el, big) => { const [x, y] = center(el), s = big ? 440 : 230; const c = spawn('ptcrater', x - s / 2, y - s * .3, '', 3600000); c.style.width = s + 'px'; c.style.height = s * .6 + 'px';
      let d = ''; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + rr(-.2, .2), l = rr(.55, 1.05) * s * .62; d += `M${s * .5} ${s * .3} L${(s * .5 + Math.cos(a) * l).toFixed(0)} ${(s * .3 + Math.sin(a) * l * .62).toFixed(0)} `; }
      c.innerHTML = `<svg viewBox="0 0 ${s} ${s * .6}" width="${s}" height="${s * .6}"><path d="${d}" stroke="#120c07" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/></svg>`; };
    /** Gag da página inteira. */
    fx.gag = (kind, el) => {
      const [px, py] = center(el), ox = px - root.scrollX, oy = py - root.scrollY;
      if (kind === 'gravity' || kind === 'float' || kind === 'hole' || kind === 'blast') wordsFly(kind, ox, oy);
      else if (kind === 'barrel') pageFx('pt-barrel', 1900, h => { h.style.transformOrigin = `50% ${root.scrollY + root.innerHeight / 2}px`; });
      else if (kind === 'mirrorpage') pageFx('pt-mirrorpage', 2300, h => { h.style.transformOrigin = `50% ${root.scrollY + root.innerHeight / 2}px`; });
      else if (kind === 'disco') pageFx('pt-disco', 3200);
      else if (kind === 'underwater') pageFx('pt-underwater', 3400, () => { if (!document.getElementById('ptwaterfx')) { const d = document.createElement('div'); d.id = 'ptwaterfx'; d.innerHTML = '<svg width="0" height="0" style="position:absolute"><filter id="ptwater" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency="0.008 0.02" numOctaves="2" seed="3" result="t"><animate attributeName="baseFrequency" dur="3.4s" values="0.008 0.02;0.016 0.034;0.008 0.02" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="26"/></filter></svg>'; document.body.appendChild(d); } });
      else if (kind === 'zerg') { for (let i = 0; i < 46; i++) later(() => { const ltr = Math.random() < .5, e = spawn('ptrun ' + (ltr ? 'ltr' : 'rtl') + ' zerg', root.scrollX + (ltr ? -60 : root.innerWidth + 20), root.scrollY + rr(40, root.innerHeight - 40), ['🐜', '🐀', '🪲', '🐛'][i % 4], 2300); e.style.setProperty('--w', root.innerWidth + 120 + 'px'); e.style.fontSize = rr(22, 44) + 'px'; e.style.animationDuration = rr(1.3, 2.3) + 's'; }, i * 45); }
    };
    /** Fim de jogo: a Cólera de Deus leva tudo. Uma caveira gigante despenca na cratera e quica (sem texto). */
    fx.gameover = () => { const e = spawn('ptgameover', 0, 0, '💀', 4200); e.style.position = 'fixed'; };
    fx.cancelGags = () => { gagTimers.forEach(clearTimeout); gagTimers = []; document.querySelectorAll('.ptgh-layer').forEach(e => e.remove()); document.body.classList.remove('pt-ghosted', 'pt-gray'); const h = document.documentElement; ['pt-barrel', 'pt-mirrorpage', 'pt-disco', 'pt-underwater'].forEach(c => h.classList.remove(c)); delete h.dataset.ptg; h.style.removeProperty('transform-origin'); gagBusy = false; };

    // ---- efeitos dos títulos (todos só visuais)
    const rr = (a, b) => a + Math.random() * (b - a);
    const emo = (x, y, ch, cls, ms, dx) => { const e = spawn('ptemo ' + cls, x, y, ch, ms); e.style.setProperty('--dx', (dx || 0) + 'px'); return e; };
    const burst = (el, chars, n, cls, ms) => { const [x, y] = center(el), w = el.offsetWidth || 90, h = el.offsetHeight || 126; for (let i = 0; i < n; i++) setTimeout(() => emo(x + rr(-w / 2, w / 2), y + rr(-h / 3, h / 3), chars[i % chars.length], cls, ms, rr(-46, 46)), i * 75); };
    const overlay = (cls, ms, html) => spawn('ptov ' + cls, 0, 0, html || '', ms);
    const E = {
      bolt: el => { const [x, y] = center(el), top = root.scrollY, h = Math.max(70, y - top), w = 240, pts = []; let px = w / 2;
        for (let i = 0; i <= 9; i++) { px = i === 9 ? w / 2 : Math.max(24, Math.min(w - 24, px + rr(-38, 38))); pts.push(px.toFixed(0) + ',' + (h * i / 9).toFixed(0)); }
        spawn('ptbolt', x - w / 2, top, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts.join(' ')}" fill="none" stroke="#9fd0ff" stroke-width="14" stroke-linejoin="round" opacity=".55"/><polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>`, 420);
        fx.flash(); fx.quake(); once(el, 'fx-burn', 700); },
      meteor: el => { later(() => { fx.crater(el, true); fx.gag('blast', el); }, 600); const [x, y] = center(el); const m = spawn('ptmeteor', x - 340, y - 460, '☄️', 1000); m.style.setProperty('--tx', '340px'); m.style.setProperty('--ty', '460px'); setTimeout(() => { fx.scorch(el, 6); fx.quake(); fx.flash(); }, 560); },
      fire: (el, ctx) => { if (!ctx.damage) fx.scorch(el, 3); if (Math.random() < .3) fx.gag('blast', el); burst(el, ['🔥'], 6, 'rise', 1200); },
      water: el => { fx.gag('underwater', el); overlay('ptwave', 2900, '<i class="w1"></i><i class="w2"></i>'); burst(el, ['💧'], 7, 'fall', 1300); },
      storm: el => { const o = overlay('ptrain', 3100); for (let i = 0; i < 70; i++) { const d = document.createElement('i'); d.style.left = rr(0, 100) + '%'; d.style.animationDelay = rr(0, 1.6) + 's'; d.style.animationDuration = rr(.45, .8) + 's'; d.style.height = rr(14, 30) + 'px'; o.appendChild(d); } setTimeout(() => { fx.flash(); fx.quake(); }, 350); },
      ice: el => { overlay('ptfrost', 2300); burst(el, ['❄️'], 8, 'fall', 1600); once(el, 'fx-frozen', 2300); },
      wind: el => { fx.gag(Math.random() < .5 ? 'float' : 'barrel', el); for (let i = 0; i < 8; i++) setTimeout(() => { const e = spawn('ptgust', root.scrollX - 60, root.scrollY + rr(60, root.innerHeight - 60), '🍃', 1500); e.style.animationDelay = '0s'; }, i * 110); document.querySelectorAll('.ptcard:not(.ghost)').forEach(c => once(c, 'fx-sway', 1400)); },
      earth: el => { fx.crater(el, false); if (Math.random() < .4) fx.gag('gravity', el); fx.quake(); const [x, y] = center(el), h = el.offsetHeight || 126; for (let i = 0; i < 7; i++) { const p = spawn('ptpuff dust', x + rr(-60, 60), y + h / 2 - 6, '', 800); p.style.animationDelay = (i * 40) + 'ms'; }
        let d = `M0 0`, px = 0, py = 0; for (let i = 0; i < 7; i++) { px += rr(14, 30); py += rr(-14, 22); d += ` L${px.toFixed(0)} ${py.toFixed(0)}`; }
        spawn('ptcrack', x - 60, y + h / 2 - 4, `<svg width="${Math.ceil(px) + 4}" height="60" viewBox="-2 -30 ${Math.ceil(px) + 4} 60"><path d="${d}" fill="none" stroke="#1d1308" stroke-width="3.5" stroke-linejoin="round"/></svg>`, 3600000); },
      dark: el => { if (Math.random() < .6) fx.gag('hole', el); overlay('ptdim', 1900); burst(el, ['💀', '👻'], 3, 'rise', 1500); },
      light: el => { const [x, y] = center(el), top = root.scrollY; const b = spawn('ptbeam', x - 55, top, '', 1500); b.style.height = Math.max(80, y - top) + 'px'; fx.sparkle(el); once(el, 'fx-gold', 1300); },
      poison: el => { overlay('ptpoison', 1900); burst(el, ['🧪', '☣️'], 6, 'fall', 1500); },
      time: el => { document.body.classList.add('pt-gray'); setTimeout(() => document.body.classList.remove('pt-gray'), 1000); const [x, y] = center(el); spawn('ptclock', x - 36, y - 36, '🕰️', 1100); },
      slash: el => { const [x, y] = center(el); spawn('ptslash', x - 170, y - 3, '', 700); once(el, 'fx-shake', 520); },
      crown: el => { const [x, y] = center(el), h = el.offsetHeight || 126; spawn('ptcrown', x - 26, y - h / 2 - 34, '👑', 1700); },
      ghost: el => { once(el, 'fx-ghost', 2100); burst(el, ['👻'], 1, 'rise', 1600); },
      coin: el => burst(el, ['🪙', '💎'], 9, 'fall', 1300),
      mind: el => burst(el, ['💡', '🧠'], 2, 'rise', 1300),
      heal: el => burst(el, ['💚', '✨'], 6, 'rise', 1400),
      music: el => burst(el, ['🎵', '🎶'], 5, 'rise', 1600),
      ninja: el => { burst(el, ['💨'], 4, 'puffemo', 800); once(el, 'fx-vanish', 1000); },
      gear: el => { const [x, y] = center(el), w = el.offsetWidth || 90, h = el.offsetHeight || 126; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => spawn('ptgear', x + a * w / 2 - 14, y + b * h / 2 - 14, '⚙️', 1400)); once(el, 'fx-sheen', 1000); },
      mirror: el => { if (Math.random() < .6) fx.gag('mirrorpage', el); const c = el.cloneNode(true); c.classList.add('fx-mirror'); c.style.pointerEvents = 'none'; c.removeAttribute('data-pid'); document.body.appendChild(c); setTimeout(() => c.remove(), 1100); },
      rainbow: el => once(el, 'fx-rainbow', 1700),
      party: el => { fx.gag('disco', el); burst(el, ['🎉'], 2, 'rise', 1200); for (let i = 0; i < 26; i++) { const e = spawn('ptconf', root.scrollX + rr(0, root.innerWidth), root.scrollY - 10, '', 2200); e.style.background = ['#ff5a5a', '#ffd34d', '#5ac8ff', '#7be07b', '#c77bff'][i % 5]; e.style.animationDelay = rr(0, .7) + 's'; } },
      food: el => burst(el, ['🍎', '🍞', '🍯', '🥧'], 4, 'rise', 1300),
      sleep: el => { fx.zzz(el); burst(el, ['💤'], 2, 'rise', 1500); },
      forest: el => burst(el, ['🌿', '🍃', '🌱'], 6, 'rise', 1400),
      rage: el => { overlay('ptrage', 1500); fx.quake(); burst(el, ['💢', '😡'], 4, 'rise', 1200); },
      zerg: el => fx.gag('zerg', el),
      force: el => { if (Math.random() < .5) fx.gag('blast', el); const [x, y] = center(el); const r = spawn('ptripple force', x, y, '', 900); r.style.animationDuration = '.8s';
        document.querySelectorAll('.ptcard:not(.ghost)').forEach(c => { if (c === el) return; const [cx, cy] = center(c), dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1; c.style.setProperty('--px', (dx / d * 46).toFixed(0) + 'px'); c.style.setProperty('--py', (dy / d * 46).toFixed(0) + 'px'); once(c, 'fx-push', 700); }); fx.quake(); },
      speed: el => { const [, y] = center(el); for (let i = 0; i < 3; i++) setTimeout(() => { const e = spawn('ptrun ltr fast', root.scrollX - 90, y - 24 + (i - 1) * 34, '💨', 1000); e.style.setProperty('--w', root.innerWidth + 180 + 'px'); }, i * 90); },
      steam: el => { const [x, y] = center(el), h = el.offsetHeight || 126; for (let i = 0; i < 7; i++) { const p = spawn('ptpuff steam', x + rr(-50, 50), y + h / 3, '', 1300); p.style.animationDelay = (i * 90) + 'ms'; } },
      castle: el => { const [x, y] = center(el); spawn('ptstamp up', x - 40, y - 60, '🏰', 1300); fx.quake(); },
      counter: el => { const [x, y] = center(el); spawn('ptstamp', x - 40, y - 40, '🚫', 1200); },
      critter: (el, ctx, k) => { const [, y] = center(el), ltr = Math.random() < .5; const e = spawn('ptrun' + (ltr ? ' ltr' : ' rtl'), root.scrollX - 90, y - 24, k.emoji, 2100); e.style.setProperty('--w', root.innerWidth + 180 + 'px'); if (!ltr) e.style.left = (root.scrollX + root.innerWidth + 10) + 'px'; },
    };
    /** Efeitos do título da carta jogada (até 2). ctx.damage = já houve chamuscado por texto de regras. */
    fx.title = (name, el, ctx) => { titleKeys(name).forEach((k, i) => setTimeout(() => E[k.key] && E[k.key](el, ctx || {}, k), i * 260)); };
    /** Terreno que virou: efeito discreto pelo nome. */
    fx.land = (name, el) => {
      const k = landKey(name); if (!k) return; const [x, y] = center(el), h = el.offsetHeight || 126;
      if (k === 'ripple') for (let i = 0; i < 3; i++) { const r = spawn('ptripple', x, y, '', 1100); r.style.animationDelay = (i * 180) + 'ms'; }
      else if (k === 'bubbles') for (let i = 0; i < 7; i++) { const b = spawn('ptbubble', x + rr(-40, 40), y + h / 3, '', 1300); b.style.animationDelay = (i * 90) + 'ms'; b.style.width = b.style.height = rr(8, 18) + 'px'; }
      else if (k === 'ember') { burst(el, ['🔥'], 3, 'rise', 1000); }
      else if (k === 'dust') for (let i = 0; i < 6; i++) { const p = spawn('ptpuff dust', x + rr(-50, 50), y + h / 2 - 8, '', 800); p.style.animationDelay = (i * 40) + 'ms'; }
      else if (k === 'leaves') burst(el, ['🍃', '🌿'], 5, 'fall', 1400);
      else if (k === 'snow') burst(el, ['❄️'], 5, 'fall', 1500);
      else if (k === 'sunray') { const b = spawn('ptbeam small', x - 30, y - 150, '', 1000); b.style.height = '150px'; }
    };

    fx.quake = () => { document.body.classList.add('pt-quake'); setTimeout(() => document.body.classList.remove('pt-quake'), 520); };
    /** Sai de cena: 'shatter' (racha e cai), 'spin' (gira para fora da tela), 'burnaway' (queima e some), 'fade'. */
    fx.leave = (el, how, done) => { el.classList.add('fx-' + how); setTimeout(() => { el.remove(); done && done(); }, how === 'spin' ? 950 : how === 'shatter' ? 750 : 650); };
  }

  return { analyze, hitByWrath, titleKeys, landKey, fx };
});
