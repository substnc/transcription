// Om Speak: ikonen, namnet och signaturen. Licenserna och versionsnumret ligger bakom knappen.
const $ = (id) => document.getElementById(id);
$('icon').appendChild(window.SpeakIcon.svg(96, '#000000'));
$('btnLicenses').onclick = () => $('licenses').classList.remove('hidden');
$('btnBack').onclick = () => $('licenses').classList.add('hidden');
window.diktera.app.info().then((i) => ($('version').textContent = `Speak ${i.version}`));
