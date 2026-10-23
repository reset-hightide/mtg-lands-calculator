// node tools/make_template.js  -> template/Calculadora_Terrenos_Template.xlsx
const fs = require('fs'), path = require('path');
const T = require('../js/template.js');
const out = path.join(__dirname, '..', 'template', 'Calculadora_Terrenos_Template.xlsx');
fs.writeFileSync(out, T.buildTemplate());
console.log('escrito', out, fs.statSync(out).size, 'bytes');
