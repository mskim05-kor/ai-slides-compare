// 블라인드 비교 뷰어: 시작 → 응답자 정보 → 자료 1~3(보기 + 문항) → 마무리 → 완료
(function () {
  const STUDY = window.STUDY;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const STORE = 'blind-deck-viewer-v2';
  const app = document.getElementById('app');

  // ---------- 상태 ----------
  const fresh = () => ({
    rid: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    step: 'intro',          // intro | profile | s1 | s2 | s3 | final | done
    startedAt: new Date().toISOString(),
    order: {},              // 시나리오별 덱 탭 순서 (A~F 고정. 서비스-글자 대응은 시나리오마다 이미 무작위)
    answers: {},            // 문항 응답
    view: {},               // 시나리오별 보기 상태 {mode, deck, slide, point}
    seen: {},               // 시나리오별 덱별 본 장 번호
    timing: {},             // 시나리오별 머문 시간(초)
    sent: {}                // 전송한 단계
  });
  let st;
  try { st = JSON.parse(localStorage.getItem(STORE)) || fresh(); } catch (e) { st = fresh(); }
  if (new URLSearchParams(location.search).has('reset')) { st = fresh(); history.replaceState(null, '', location.pathname); }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} };

  STUDY.scenarios.forEach(s => { st.order[s.id] = LETTERS.slice(); });
  save();

  // ---------- 전송 ----------
  // 보낼 응답을 대기열에 쌓고, 성공한 것만 지운다. 실패분은 다음 전송 때 다시 보낸다
  const QKEY = STORE + '-pending';
  const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } };
  const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} };
  let flushing = false;
  async function flush() {
    if (flushing || !window.ENDPOINT) return;
    flushing = true;
    try {
      // 보내는 동안 새로 쌓인 것까지 대기열이 빌 때까지 보낸다
      while (true) {
        const body = readQ()[0];
        if (!body) break;
        try {
          const r = await fetch(window.ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
          if (!r.ok) break;
          writeQ(readQ().filter(b => b !== body));
        } catch (err) { console.warn('전송 실패, 다음에 다시 보냄', err); break; }
      }
    } finally { flushing = false; }
  }
  function send(step, payload) {
    const body = JSON.stringify({ rid: st.rid, step, ts: new Date().toISOString(), payload });
    writeQ([...readQ(), body]);
    if (!window.ENDPOINT) { console.info('[미리보기] 전송 생략', body); return; }
    flush();
  }
  window.addEventListener('online', flush);
  flush();

  // ---------- 공통 ----------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(k => n.append(k instanceof Node ? k : document.createTextNode(String(k))));
    return n;
  };
  const img = (s, L, n, thumb) => `img/${s}/${L}/${thumb ? 't/' : ''}${String(n).padStart(2, '0')}.jpg`;
  let enteredAt = Date.now();
  // 이미지 미리 불러오기 (참조를 들고 있어야 브라우저가 버리지 않음)
  const cache = new Map();
  const preload = (src) => { if (!cache.has(src)) { const im = new Image(); im.src = src; cache.set(src, im); } return cache.get(src); };
  const preloadDeck = (sid, L, n) => { for (let i = 1; i <= n; i++) preload(img(sid, L, i)); };
  let viewerApi = null;
  const STEPS = ['profile', 's1', 's2', 's3', 'final'];
  const progress = () => el('div', { class: 'progress' }, STEPS.map((k, i) => el('span', { class: i <= STEPS.indexOf(st.step) ? 'on' : '' })));
  function restart() {
    if (!confirm('지금까지 고른 답이 지워져요. 처음부터 다시 할까요?')) return;
    if (st.step !== 'intro') send('reset', { fromStep: st.step });
    st = fresh(); STUDY.scenarios.forEach(s => { st.order[s.id] = LETTERS.slice(); });
    save(); render(); window.scrollTo(0, 0);
  }
  const topbar = () => el('div', { class: 'topbar' }, el('button', { class: 'link', onclick: restart }, '처음부터 다시'));
  const go = (step) => { st.step = step; save(); enteredAt = Date.now(); render(); window.scrollTo(0, 0); };

  function radioGroup(name, options, { col = false } = {}) {
    const wrap = el('div', { class: 'opts' + (col ? ' col' : '') });
    const paint = () => wrap.querySelectorAll('label').forEach(l => l.classList.toggle('on', l.dataset.v === st.answers[name]));
    options.forEach(o => {
      const lab = el('label', { 'data-v': o },
        el('input', { type: 'radio', name, value: o, onchange: () => { st.answers[name] = o; save(); paint(); } }), o);
      wrap.append(lab);
    });
    paint();
    return wrap;
  }
  function textField(name, { long = false, placeholder = '' } = {}) {
    const f = el(long ? 'textarea' : 'input', { type: long ? null : 'text', placeholder, oninput: (e) => { st.answers[name] = e.target.value; save(); } });
    f.value = st.answers[name] || '';
    return f;
  }
  const q = (title, required, control, help) => el('div', { class: 'q' },
    el('div', { class: 'q-title' }, title, el('span', { class: 'req' }, required ? '(필수)' : '(선택)')),
    help ? el('div', { class: 'q-help' }, help) : '', control);

  function requireAll(names) {
    const missing = names.filter(n => !(st.answers[n] && String(st.answers[n]).trim()));
    return missing.length === 0;
  }

  // ---------- 화면: 시작 ----------
  function renderIntro() {
    const step = (n, title, desc) => el('div', { class: 'step' }, el('div', { class: 'step-no' }, n), el('div', {}, el('div', { class: 'step-title' }, title), el('div', { class: 'dim' }, desc)));
    app.append(
      el('h1', {}, 'AI 발표자료 비교'),
      el('p', {}, '같은 원고로 AI 서비스 6개에게 발표자료를 만들어 달라고 했어요. 상황 3개에서 각각 어떤 자료가 좋아 보이는지 알려주세요.'),
      el('div', { class: 'card' },
        el('div', { class: 'q-title' }, '이렇게 진행돼요'),
        step('1', '상황 읽기', '누가, 어떤 자리에서, 누구에게 보여줄 자료인지 먼저 읽어주세요.'),
        step('2', '자료 6개 둘러보기', '"자료별로 보기"에서 A~F를 한 장씩 넘겨보고, "한눈에 보기"에서 자료 6개의 전체 모습을, "같은 장 비교"에서 표지처럼 같은 내용을 다룬 장을 나란히 볼 수 있어요.'),
        step('3', '질문에 답하기', '이 상황에서 쓰고 싶은 자료와 AI가 만든 티가 나는 자료를 골라주세요. 자료마다 4문항이에요.'),
        el('p', { class: 'dim', style: 'margin:12px 0 0' }, '이 과정을 상황 3개에서 반복하고, 마지막에 몇 가지만 더 여쭤볼게요.')),
      el('div', { class: 'card surface' },
        el('p', {}, '· 7~8분 정도 걸려요'),
        el('p', {}, '· 정답은 없어요. 처음 봤을 때 느낌 그대로 골라주시면 돼요'),
        el('p', { style: 'margin:0' }, '· 어떤 서비스가 만든 자료인지는 알려드리지 않아요')),
      el('button', { class: 'btn block', onclick: () => go('profile') }, '시작하기')
    );
  }

  // ---------- 화면: 응답자 정보 ----------
  function renderProfile() {
    const err = el('div', { class: 'err' });
    app.append(progress(),
      el('h2', {}, '먼저 간단히 여쭤볼게요'),
      q('하시는 일과 가장 가까운 것을 골라주세요', true,
        radioGroup('job', ['회사원(사무직)', '회사원(디자인·마케팅)', '교사·강사', '학생', '프리랜서·자영업', '기타'], { col: true })),
      q('발표 자료(PPT)를 얼마나 자주 만드세요?', true,
        radioGroup('pptFreq', ['주 1회 이상', '한 달에 1~3번', '몇 달에 한 번', '거의 안 만듦'], { col: true })),
      err,
      el('button', { class: 'btn block', onclick: () => {
        if (!requireAll(['job', 'pptFreq'])) { err.textContent = '두 문항 모두 골라주세요'; return; }
        send('profile', { job: st.answers.job, pptFreq: st.answers.pptFreq, ua: navigator.userAgent, w: innerWidth });
        go('s1');
      } }, '다음')
    );
  }

  // ---------- 화면: 시나리오 ----------
  function renderScenario(sc) {
    const v = st.view[sc.id] || (st.view[sc.id] = { mode: 'deck', deck: st.order[sc.id][0], slide: 1, point: 0 });
    st.seen[sc.id] = st.seen[sc.id] || {};
    const markSeen = () => { const s = st.seen[sc.id]; (s[v.deck] = s[v.deck] || {})[v.slide] = 1; save(); };

    const viewer = el('div');
    const drawViewer = () => {
      viewerApi = null;
      viewer.replaceChildren(v.mode === 'deck' ? deckView() : v.mode === 'overview' ? overviewView() : compareView());
    };
    const openDeck = (L, n) => { v.mode = 'deck'; v.deck = L; v.slide = n || 1; save(); render(); };

    // 자료별로 보기: 덱을 열 때 한 번만 그리고, 장을 넘길 때는 큰 이미지와 선택 표시만 바꾼다
    function deckView() {
      const n = sc.decks[v.deck];
      preloadDeck(sc.id, v.deck, n);
      const tabs = el('div', { class: 'tabs' }, st.order[sc.id].map(L => el('button', {
        class: (L === v.deck ? 'on' : '') + (st.seen[sc.id][L] ? ' seen' : ''),
        onclick: () => { v.deck = L; v.slide = 1; save(); drawViewer(); }
      }, L)));
      const main = el('img', { src: img(sc.id, v.deck, v.slide), alt: '' });
      const label = el('span', { class: 'dim' });
      const prevBtn = el('button', { 'aria-label': '이전 장', onclick: () => move(-1) }, '‹');
      const nextBtn = el('button', { 'aria-label': '다음 장', onclick: () => move(1) }, '›');
      const thumbs = el('div', { class: 'thumbs' });
      const thumbImgs = [];
      for (let i = 1; i <= n; i++) {
        const t = el('img', { src: img(sc.id, v.deck, i, true), alt: `${i}번째 장`, onclick: () => goTo(i) });
        thumbImgs.push(t); thumbs.append(t);
      }
      function update() {
        markSeen();
        const src = img(sc.id, v.deck, v.slide);
        const pre = cache.get(src);
        if (pre && pre.complete) main.src = src;            // 미리 불러온 이미지는 바로 교체
        else { const im = new Image(); im.onload = () => { if (img(sc.id, v.deck, v.slide) === src) main.src = src; }; im.src = src; }
        main.alt = `자료 ${v.deck} ${v.slide}번째 장`;
        label.textContent = `자료 ${v.deck} · ${v.slide} / ${n}`;
        prevBtn.disabled = v.slide === 1; nextBtn.disabled = v.slide === n;
        thumbImgs.forEach((t, i) => t.classList.toggle('on', i + 1 === v.slide));
        const on = thumbImgs[v.slide - 1];
        if (on) thumbs.scrollTo({ left: on.offsetLeft - thumbs.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' });
      }
      function goTo(i) { v.slide = i; save(); update(); }
      function move(d) { const ns = v.slide + d; if (ns < 1 || ns > n) return; goTo(ns); }
      const stage = el('div', { class: 'stage' }, main,
        el('button', { class: 'nav prev', 'aria-label': '이전 장', onclick: () => move(-1) }),
        el('button', { class: 'nav next', 'aria-label': '다음 장', onclick: () => move(1) }));
      let sx = null;
      stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) move(dx < 0 ? 1 : -1); sx = null; });
      const bar = el('div', { class: 'stage-bar' }, label, el('div', { class: 'arrows' }, prevBtn, nextBtn));
      viewerApi = { move };
      setTimeout(update, 0);
      return el('div', {}, tabs, stage, bar, thumbs);
    }

    // 한눈에 보기: 덱마다 한 줄, 모든 장을 가로로 펼쳐 전체 인상을 비교
    function overviewView() {
      const rows = st.order[sc.id].map(L => {
        const n = sc.decks[L];
        const strip = el('div', { class: 'ov-strip' });
        for (let i = 1; i <= n; i++) strip.append(el('img', { src: img(sc.id, L, i, true), alt: `자료 ${L} ${i}번째 장`, onclick: () => openDeck(L, i) }));
        return el('div', { class: 'ov-row' }, el('div', { class: 'ov-label' }, `자료 ${L}`, el('span', { class: 'dim' }, ` · ${n}장`)), strip);
      });
      return el('div', {}, el('p', { class: 'dim' }, '자료마다 모든 장을 한 줄로 펼쳤어요. 옆으로 밀어서 보고, 누르면 그 장부터 크게 볼 수 있어요.'), ...rows);
    }

    function compareView() {
      const pt = sc.compare[v.point];
      const chips = el('div', { class: 'chips' }, sc.compare.map((c, i) => el('button', {
        class: i === v.point ? 'on' : '', onclick: () => { v.point = i; save(); drawViewer(); }
      }, c.name)));
      const grid = el('div', { class: 'grid' }, st.order[sc.id].map(L => {
        const n = pt.slides[L];
        return el('figure', { onclick: () => { if (n) openDeck(L, n); } },
          el('figcaption', {}, `자료 ${L}`),
          n ? el('img', { src: img(sc.id, L, n), alt: `자료 ${L} ${pt.name}` }) : el('div', { class: 'none' }, '해당하는 장이 없어요'));
      }));
      return el('div', {}, chips, el('p', { class: 'dim' }, '같은 내용을 다룬 장끼리 모았어요. 누르면 그 자료를 이어서 넘겨볼 수 있어요.'), grid);
    }

    const segBtn = (mode, text) => el('button', { class: v.mode === mode ? 'on' : '', onclick: () => { v.mode = mode; save(); render(); } }, text);
    const seg = el('div', { class: 'seg' }, segBtn('deck', '자료별로 보기'), segBtn('overview', '한눈에 보기'), segBtn('compare', '같은 장 비교'));
    // 이 시나리오의 썸네일은 처음에 모두 불러둔다
    STUDY.scenarios.filter(x => x.id === sc.id).forEach(x => LETTERS.forEach(L => { for (let i = 1; i <= x.decks[L]; i++) preload(img(x.id, L, i, true)); }));

    const p = sc.id + '_';
    const err = el('div', { class: 'err' });
    const idx = STUDY.scenarios.indexOf(sc);
    app.append(progress(),
      el('h2', {}, `자료 ${sc.no} / 3 · ${sc.title}`),
      el('details', { class: 'context card surface', open: true },
        el('summary', {}, '어떤 상황인가요?'),
        el('p', {}, sc.context), el('p', {}, sc.goal)),
      seg, viewer,
      el('p', { class: 'dim' }, '휴대폰은 가로로 돌리거나 두 손가락으로 확대하면 더 크게 볼 수 있어요.'),
      el('div', { class: 'sep' }),
      q('이 상황이라면 어떤 자료를 쓰고 싶으세요?', true, radioGroup(p + 'pick', LETTERS)),
      q('그 자료를 고른 이유를 알려주세요', true,
        textField(p + 'pickWhy', { long: true, placeholder: '예: 3번째 장처럼 장마다 핵심 문장이 맨 위에 있어서 말하기 편할 것 같았어요. 표지 그림도 상황에 잘 맞았어요.' }),
        '몇 번째 장의 어떤 점(구성, 글씨, 그림, 색 등) 때문인지 적어주시면 큰 도움이 돼요.'),
      q('AI가 만든 티가 가장 많이 나는 자료는 어떤 건가요?', true, radioGroup(p + 'ai', [...LETTERS, '잘 모르겠음'])),
      q('어떤 부분에서 AI가 만든 티를 느끼셨어요?', true,
        textField(p + 'aiWhy', { long: true, placeholder: '예: 5번째 장 그림이 내용과 상관없어 보였어요. 장마다 비슷한 상자가 반복돼서 기계적으로 찍어낸 느낌이었어요.' }),
        '앞에서 고른 자료의 어느 장, 어떤 점에서 그렇게 느꼈는지 적어주세요. "잘 모르겠음"을 골랐다면 비워두셔도 돼요.'),
      err,
      el('div', { class: 'footer-actions' },
        el('button', { class: 'btn ghost', onclick: () => go(idx === 0 ? 'profile' : STUDY.scenarios[idx - 1].id) }, '이전'),
        el('button', { class: 'btn', onclick: () => {
          const need = [p + 'pick', p + 'pickWhy', p + 'ai'];
          if (st.answers[p + 'ai'] && st.answers[p + 'ai'] !== '잘 모르겠음') need.push(p + 'aiWhy');
          if (!requireAll(need)) { err.textContent = '필수 문항에 모두 답해주세요'; return; }
          st.timing[sc.id] = (st.timing[sc.id] || 0) + Math.round((Date.now() - enteredAt) / 1000);
          const seenCount = Object.fromEntries(LETTERS.map(L => [L, Object.keys(st.seen[sc.id][L] || {}).length]));
          send(sc.id, { pick: st.answers[p + 'pick'], pickWhy: st.answers[p + 'pickWhy'], ai: st.answers[p + 'ai'], aiWhy: st.answers[p + 'aiWhy'] || '', order: st.order[sc.id].join(''), seconds: st.timing[sc.id], seen: seenCount });
          go(idx === STUDY.scenarios.length - 1 ? 'final' : STUDY.scenarios[idx + 1].id);
        } }, idx === STUDY.scenarios.length - 1 ? '마지막 질문으로' : '다음 자료'))
    );
    drawViewer();
  }

  // ---------- 화면: 마무리 ----------
  function renderFinal() {
    const err = el('div', { class: 'err' });
    const idBlock = el('div', {}, STUDY.scenarios.map(sc => el('div', { class: 'idgrid' },
      el('div', { class: 'q-title' }, `자료 ${sc.no} · ${sc.title}`),
      el('div', { class: 'covers' }, LETTERS.map(L => el('div', {}, el('img', { src: img(sc.id, L, 1, true), alt: `자료 ${L} 표지` }), L))),
      radioGroup(`${sc.id}_miri`, [...LETTERS, '잘 모르겠음']))));
    app.append(progress(),
      el('h2', {}, '마지막으로 몇 가지만 여쭤볼게요'),
      el('div', { class: 'q' }, el('div', { class: 'q-title' }, '자료마다, 미리캔버스로 만든 것 같은 자료가 있었나요?', el('span', { class: 'req' }, '(필수)')), idBlock),
      q('미리캔버스를 써본 적이 있나요?', true, radioGroup('miriUse', ['자주 써요', '가끔 써요', '써본 적은 있어요', '써본 적 없어요'], { col: true })),
      q('더 하고 싶은 말이 있다면 자유롭게 남겨주세요', false, textField('free', { long: true })),
      err,
      el('div', { class: 'footer-actions' },
        el('button', { class: 'btn ghost', onclick: () => go('s3') }, '이전'),
        el('button', { class: 'btn', onclick: () => {
          const need = [...STUDY.scenarios.map(s => `${s.id}_miri`), 'miriUse'];
          if (!requireAll(need)) { err.textContent = '필수 문항에 모두 답해주세요'; return; }
          send('final', { s1_miri: st.answers.s1_miri, s2_miri: st.answers.s2_miri, s3_miri: st.answers.s3_miri, miriUse: st.answers.miriUse, free: st.answers.free || '', startedAt: st.startedAt });
          go('done');
        } }, '제출하기'))
    );
  }

  function renderDone() {
    app.append(
      el('h1', {}, '감사합니다!'),
      el('p', {}, '응답이 저장됐어요. 도와주셔서 고마워요.'),
      el('p', { class: 'dim' }, '이 창은 닫으셔도 돼요.'));
  }

  // ---------- 렌더 ----------
  function render() {
    app.replaceChildren();
    if (st.step !== 'intro') app.append(topbar());
    const sc = STUDY.scenarios.find(s => s.id === st.step);
    if (st.step === 'intro') renderIntro();
    else if (st.step === 'profile') renderProfile();
    else if (sc) renderScenario(sc);
    else if (st.step === 'final') renderFinal();
    else renderDone();
  }

  // 키보드 ← → 로 장 넘기기 (자료별 보기에서만)
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || !viewerApi) return;
    if (e.key === 'ArrowRight') viewerApi.move(1);
    if (e.key === 'ArrowLeft') viewerApi.move(-1);
  });

  render();
})();
