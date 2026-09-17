const api = (p) => fetch('https://api.github.com/repos/YuriyRS/napominalka' + p, { headers: { 'User-Agent': 'domovoy' } }).then((r) => r.json());
const started = Date.now();
let seen = null;

for (let i = 0; i < 40; i++) {
  const j = await api('/actions/runs?per_page=5');
  const run = (j.workflow_runs || []).find(
    (x) => x.event === 'workflow_dispatch' && Date.parse(x.created_at) > started - 15 * 60_000);
  if (run && run.id !== seen) {
    seen = run.id;
    console.log(new Date().toISOString().slice(11, 19), 'запущена:', run.status, run.html_url);
  }
  if (run?.status === 'completed') {
    console.log('ИТОГ:', run.conclusion);
    const jobs = await api('/actions/runs/' + run.id + '/jobs');
    for (const st of jobs.jobs?.[0]?.steps || []) {
      if (st.conclusion === 'failure') console.log('  УПАЛО:', st.name);
      else if (['Релизная сборка с подписью', 'Что видит магазин в релизной сборке'].includes(st.name)) console.log('  ок:', st.name);
    }
    process.exit(0);
  }
  if (!run && i % 4 === 0) console.log(new Date().toISOString().slice(11, 19), 'ждём запуска…');
  await new Promise((r) => setTimeout(r, 20_000));
}
console.log('сборка так и не началась — возможно, кнопку ещё не нажали');
process.exit(1);
