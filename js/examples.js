/*
 * Decks de exemplo sorteados pelo dado. Só guardam quantidade, nome e categoria; a lista no formato do
 * export do Archidekt ("1x Nome (set) 123 [Categoria]") é montada com o set e o número de coleção do Scryfall.
 */
(function (root) {
  'use strict';
  const S = (cat, names) => names.map(n => [1, n, cat]);   // singletons (Commander)
  const EXAMPLES = [
    { name: 'Izzet Tempo', wheel: 'Taça', cards: [
      [4, 'Delver of Secrets', 'Threat'], [4, 'Brazen Borrower', 'Threat'], [4, 'Counterspell', 'Counter'], [4, 'Lightning Bolt', 'Burn'],
      [4, 'Brainstorm', 'Draw'], [4, 'Murktide Regent', 'Threat'], [4, "Dragon's Rage Channeler", 'Threat'], [2, 'Force of Will', 'Counter'],
      [4, 'Expressive Iteration', 'Draw'], [2, 'Fire // Ice', 'Burn'], [8, 'Island', 'Land'], [6, 'Mountain', 'Land'], [4, 'Steam Vents', 'Land'],
      [4, 'Spirebluff Canal', 'Land'], [2, 'Scalding Tarn', 'Land'], [2, 'Negate', 'Sideboard'], [1, 'Shock', 'Maybeboard{noDeck}{noPrice}'] ] },
    { name: 'Mono-Red Aggro', wheel: 'Espada', cards: [
      [4, 'Goblin Guide', 'Threat'], [4, 'Monastery Swiftspear', 'Threat'], [4, 'Vexing Devil', 'Threat'], [4, 'Eidolon of the Great Revel', 'Threat'],
      [4, 'Burst Lightning', 'Burn'], [4, 'Lightning Bolt', 'Burn'], [4, 'Chain Lightning', 'Burn'], [4, 'Rift Bolt', 'Burn'],
      [4, 'Skewer the Critics', 'Burn'], [4, 'Lava Spike', 'Burn'], [20, 'Mountain', 'Land'], [3, 'Smash to Smithereens', 'Sideboard'] ] },
    { name: 'Simic Ramp', wheel: 'Coração', cards: [
      [4, 'Llanowar Elves', 'Ramp'], [4, 'Elvish Mystic', 'Ramp'], [4, 'Rampant Growth', 'Ramp'], [4, 'Cultivate', 'Ramp'], [4, 'Growth Spiral', 'Ramp'],
      [4, 'Hydroid Krasis', 'Finisher'], [4, 'Nissa, Who Shakes the World', 'Finisher'], [3, 'Ugin, the Spirit Dragon', 'Finisher'],
      [3, 'Elder Gargaroth', 'Finisher'], [4, 'Breeding Pool', 'Land'], [4, 'Hinterland Harbor', 'Land'], [4, 'Temple of Mystery', 'Land'],
      [8, 'Forest', 'Land'], [6, 'Island', 'Land'], [2, 'Negate', 'Sideboard'] ] },
    { name: 'Azorius Control', wheel: 'Taça', cards: [
      [4, 'Counterspell', 'Counter'], [3, 'Absorb', 'Counter'], [4, 'Supreme Verdict', 'Wrath'], [4, 'Swords to Plowshares', 'Removal'],
      [4, 'Brainstorm', 'Draw'], [3, 'Teferi, Hero of Dominaria', 'Planeswalker'], [3, 'Jace, the Mind Sculptor', 'Planeswalker'],
      [4, 'Azorius Charm', 'Flexible'], [3, "Sphinx's Revelation", 'Draw'], [2, 'Wrath of God', 'Wrath'], [2, 'Baneslayer Angel', 'Finisher'],
      [4, 'Hallowed Fountain', 'Land'], [4, 'Flooded Strand', 'Land'], [4, 'Celestial Colonnade', 'Land'], [6, 'Island', 'Land'],
      [6, 'Plains', 'Land'], [2, 'Rest in Peace', 'Sideboard'] ] },
    { name: 'Golgari Midrange', wheel: 'Caveira', cards: [
      [4, 'Tarmogoyf', 'Threat'], [4, 'Dark Confidant', 'Threat'], [4, 'Liliana of the Veil', 'Planeswalker'], [4, 'Thoughtseize', 'Discard'],
      [4, 'Inquisition of Kozilek', 'Discard'], [4, 'Abrupt Decay', 'Removal'], [3, 'Maelstrom Pulse', 'Removal'], [4, 'Courser of Kruphix', 'Threat'],
      [2, "Vraska's Contempt", 'Removal'], [2, "Hero's Downfall", 'Removal'], [4, 'Overgrown Tomb', 'Land'], [4, 'Verdant Catacombs', 'Land'],
      [3, 'Woodland Cemetery', 'Land'], [7, 'Swamp', 'Land'], [7, 'Forest', 'Land'], [3, 'Thorn of the Black Rose', 'Sideboard'] ] },
    { name: 'Simic Ramp Commander (Tatyova)', wheel: 'Coração', cards: [
      [1, 'Tatyova, Benthic Druid', 'Commander{top}'],
      ...S('Ramp', ['Sol Ring', 'Arcane Signet', 'Fellwar Stone', 'Simic Signet', 'Talisman of Curiosity', 'Gilded Lotus', "Cultivator's Caravan", 'Cultivate',
        "Kodama's Reach", 'Rampant Growth', 'Farseek', "Nature's Lore", 'Three Visits', 'Explosive Vegetation', 'Skyshroud Claim', 'Harrow', 'Utopia Sprawl', 'Wild Growth']),
      ...S('Creature', ['Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Fyndhorn Elves', 'Lotus Cobra', 'Wall of Roots', 'Sakura-Tribe Elder', 'Wood Elves',
        'Oracle of Mul Daya', 'Courser of Kruphix', 'Dryad of the Ilysian Grove']),
      ...S('Engine', ['Azusa, Lost but Seeking', 'Exploration', 'Burgeoning', 'Zendikar Resurgent', 'Sylvan Library', 'Life from the Loam', 'Crop Rotation', 'Mystic Remora', 'Rhystic Study']),
      ...S('Interaction', ['Cyclonic Rift', 'Counterspell', 'Swan Song', 'Mana Drain', 'Mana Leak', 'Remand', 'Mystic Snake', 'Beast Within', 'Heroic Intervention', 'Return to Nature']),
      ...S('Value', ['Brainstorm', 'Ponder', 'Preordain', 'Fact or Fiction', 'Mulldrifter', 'Coiling Oracle', 'Eternal Witness', 'Reclamation Sage', 'Worldly Tutor']),
      ...S('Finisher', ['Craterhoof Behemoth', 'Avenger of Zendikar', 'Hydroid Krasis', 'Genesis Wave']),
      ...S('Land', ['Command Tower', 'Exotic Orchard', 'Breeding Pool', 'Hinterland Harbor', 'Yavimaya Coast', 'Misty Rainforest', 'Tangled Islet', 'Thornwood Falls',
        'Temple of Mystery', 'Simic Growth Chamber', 'Reliquary Tower']),
      [14, 'Forest', 'Land'], [13, 'Island', 'Land'] ] },
  ];

  /** Lista no formato do export de texto do Archidekt. `lookup(nome)` devolve a carta do Scryfall (com set e collector_number). */
  function toArchidekt(ex, lookup) {
    return ex.cards.map(([q, name, cat]) => {
      const c = lookup(name);
      const tag = cat ? ` [${cat}]` : '';
      return c && c.set ? `${q}x ${c.name} (${c.set}) ${c.collector_number}${tag}` : `${q}x ${name}${tag}`;
    }).join('\n');
  }

  root.EXAMPLES = EXAMPLES;
  root.ExamplesText = toArchidekt;
})(typeof self !== 'undefined' ? self : this);
