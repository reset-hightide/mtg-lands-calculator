/* Formulário de feedback: o mesmo esquema do site do Hero's Shield (WhatsApp com a mensagem pronta, ou e-mail via formsubmit.co com plano B no app de e-mail). */
(function () {
  var f = document.getElementById('fbform'), msg = document.getElementById('fbmsg'), sel = document.getElementById('fbtipo'), ta = document.getElementById('fbtext');
  var WA = '5515996666366', MAIL = 'gebara.eng@gmail.com', SITE = 'Calculadora de Terrenos MTG';
  var T = { tipos: ['Sugestão', 'Erro ou problema', 'Elogio', 'Outro comentário'], ph: 'Escreva aqui a sua mensagem...', need: 'Escreva a mensagem antes de enviar.', wa: 'Abrimos o WhatsApp com a mensagem pronta. É só tocar em enviar.', sending: 'Enviando...', ok: 'Obrigado! Sua mensagem foi enviada.', fail: 'Não deu para enviar daqui.', open: 'Abrir no seu app de e-mail' };
  T.tipos.forEach(function (x) { var o = document.createElement('option'); o.textContent = x; sel.appendChild(o); });
  ta.placeholder = T.ph;
  function data() { return { tipo: sel.value, mensagem: ta.value.trim(), nome: f.nome.value.trim(), email: f.email.value.trim(), honey: f._honey.value }; }
  function text(d) { return '[' + SITE + '] ' + d.tipo + '\n\n' + d.mensagem + (d.nome ? '\n\n- ' + d.nome : '') + (d.email ? ' (' + d.email + ')' : ''); }
  f.addEventListener('click', function (e) {
    var b = e.target.closest('button'), via = b && b.dataset.via; if (!via) return;
    var d = data(); if (d.honey) return;
    if (!d.mensagem) { msg.textContent = T.need; ta.focus(); return; }
    if (via === 'wa') { window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(text(d)), '_blank', 'noopener'); msg.textContent = T.wa; return; }
    var btns = f.querySelectorAll('button'); btns.forEach(function (x) { x.disabled = true; }); msg.textContent = T.sending;
    fetch('https://formsubmit.co/ajax/' + MAIL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ _subject: '[' + SITE + '] ' + d.tipo, _template: 'table', _captcha: 'false', assunto: d.tipo, mensagem: d.mensagem, nome: d.nome || '-', email: d.email || '-', pagina: location.href }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || String(j.success) === 'false') throw new Error('fail'); }); })
      .then(function () { msg.textContent = T.ok; ta.value = ''; })
      .catch(function () { var a = document.createElement('a'); a.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('[' + SITE + '] ' + d.tipo) + '&body=' + encodeURIComponent(text(d)); a.textContent = T.open; msg.textContent = T.fail + ' '; msg.appendChild(a); })
      .then(function () { btns.forEach(function (x) { x.disabled = false; }); });
  });
})();
