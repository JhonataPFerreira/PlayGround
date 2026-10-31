/* ============================================================
   Script Studio — estúdio de roteiros e sinais (execução manual)
   Nenhuma conexão com corretora, conta ou API não oficial.
   ============================================================ */
(() => {
  'use strict';

  const DRAFT_KEY = 'script-studio:draft:v1';
  const PRESETS_KEY = 'script-studio:presets:v1';
  const NOTICE_KEY = 'script-studio:notice:v1';

  const TF_MINUTES = { M1: 1, M5: 5, M15: 15 };
  const SESSION_LABELS = { asia: 'Ásia', london: 'Londres', ny: 'Nova York' };

  const DEFAULTS = {
    name: 'Engolfo de reversão',
    asset: 'EUR/USD (OTC)',
    timeframe: 'M1',
    expiry: 1,
    strategy: 'engulfing',
    direction: 'both',
    trendFilter: true,
    trendPeriod: 50,
    rsiFilter: false,
    rsiPeriod: 14,
    rsiMin: 45,
    rsiMax: 70,
    avoidDoji: true,
    sessions: ['london', 'ny'],
    balance: 1000,
    stakeMode: 'percent',
    stakeValue: 20,
    stakePercent: 2,
    payout: 80,
    martingale: false,
    mgLevels: 2,
    mgMultiplier: 2,
    dailyLossLimit: 10,
    maxTrades: 10,
    notes: ''
  };

  const STRATEGIES = {
    engulfing: {
      label: 'Engolfo (reversão)',
      setup: 'O candle de sinal precisa engolir o corpo do candle anterior. Funciona melhor em suporte/resistência visível.',
      callRule: 'Candle anterior vermelho (fechou abaixo da abertura). O candle atual abre no fechamento anterior ou abaixo e fecha acima da abertura anterior, engolindo todo o corpo.',
      putRule: 'Candle anterior verde. O candle atual abre no fechamento anterior ou acima e fecha abaixo da abertura anterior, engolindo todo o corpo.',
      callShort: 'Engolfo de alta',
      putShort: 'Engolfo de baixa',
      codeReasonCall: 'Engolfo de alta',
      codeReasonPut: 'Engolfo de baixa'
    },
    hammer: {
      label: 'Martelo / estrela cadente',
      setup: 'Procure o padrão em zonas de suporte (martelo) ou resistência (estrela cadente), após um movimento esticado.',
      callRule: 'Martelo: corpo pequeno na parte de cima do candle, sombra inferior de pelo menos 2× o corpo e sombra superior curta.',
      putRule: 'Estrela cadente: corpo pequeno na parte de baixo, sombra superior de pelo menos 2× o corpo e sombra inferior curta.',
      callShort: 'Martelo',
      putShort: 'Estrela cadente',
      codeReasonCall: 'Martelo',
      codeReasonPut: 'Estrela cadente'
    },
    rsiEma: {
      label: 'Cruzamento EMA 9/21 + RSI',
      setup: 'Segue o momentum: precisa do cruzamento das médias com o RSI confirmando, sem sobrecompra/sobrevenda extrema.',
      callRule: 'EMA 9 cruza acima da EMA 21 e o RSI 14 está entre 45 e 70.',
      putRule: 'EMA 9 cruza abaixo da EMA 21 e o RSI 14 está entre 30 e 55.',
      callShort: 'EMA 9 acima da 21 + RSI',
      putShort: 'EMA 9 abaixo da 21 + RSI',
      codeReasonCall: 'EMA 9 cruzou acima da 21',
      codeReasonPut: 'EMA 9 cruzou abaixo da 21'
    },
    bollinger: {
      label: 'Reversão nas Bandas de Bollinger',
      setup: 'Reversão à média: o preço fura a banda e volta para dentro dela no candle seguinte. Evite em tendência muito forte.',
      callRule: 'Um candle fecha abaixo da banda inferior e o candle seguinte volta a fechar dentro da banda.',
      putRule: 'Um candle fecha acima da banda superior e o candle seguinte volta a fechar dentro da banda.',
      callShort: 'Reversão na banda inferior',
      putShort: 'Reversão na banda superior',
      codeReasonCall: 'Reversão na banda inferior',
      codeReasonPut: 'Reversão na banda superior'
    },
    breakout: {
      label: 'Rompimento de máxima/mínima',
      setup: 'Rompimento dos últimos 20 candles com fechamento decidido. Funciona melhor em abertura de sessão.',
      callRule: 'Fechamento acima da máxima dos últimos 20 candles.',
      putRule: 'Fechamento abaixo da mínima dos últimos 20 candles.',
      callShort: 'Rompimento de máxima',
      putShort: 'Rompimento de mínima',
      codeReasonCall: 'Rompimento de máxima',
      codeReasonPut: 'Rompimento de mínima'
    }
  };

  /* ---------------------------- utilidades ---------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const num = (v, fb = 0) => {
    if (v === '' || v === null || v === undefined) return fb;
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const clamp = (v, min, max, fb) => Math.min(max, Math.max(min, num(v, fb)));
  const clampInt = (v, min, max, fb) => Math.round(clamp(v, min, max, fb));
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const roundPrice = (v) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 100000) / 100000);

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (v) => moneyFmt.format(Number.isFinite(Number(v)) ? Number(v) : 0);
  const signedMoney = (v) => (Number(v) > 0 ? '+' : '') + money(v);
  const pct = (v) => `${num(v).toFixed(1).replace('.', ',')}%`;

  const formatPrice = (v) => {
    const abs = Math.abs(num(v));
    const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 5;
    return num(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const slug = (s) =>
    String(s || 'estrategia')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'estrategia';

  const safeComment = (s) => String(s).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  const candleLabel = (c, index) => {
    if (c && c.time) {
      const d = new Date(c.time);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }
      if (typeof c.time === 'string') return c.time.slice(0, 16);
    }
    return `#${index + 1}`;
  };

  /* ---------------------------- estado ---------------------------- */
  function sanitize(raw) {
    const b = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    const out = {
      name: String(b.name || DEFAULTS.name).slice(0, 48),
      asset: String(b.asset || DEFAULTS.asset).slice(0, 40) || DEFAULTS.asset,
      timeframe: Object.prototype.hasOwnProperty.call(TF_MINUTES, b.timeframe) ? b.timeframe : DEFAULTS.timeframe,
      expiry: clampInt(b.expiry, 1, 5, DEFAULTS.expiry),
      strategy: STRATEGIES[b.strategy] ? b.strategy : DEFAULTS.strategy,
      direction: ['both', 'call', 'put'].includes(b.direction) ? b.direction : DEFAULTS.direction,
      trendFilter: Boolean(b.trendFilter),
      trendPeriod: clampInt(b.trendPeriod, 9, 200, DEFAULTS.trendPeriod),
      rsiFilter: Boolean(b.rsiFilter),
      rsiPeriod: clampInt(b.rsiPeriod, 5, 50, DEFAULTS.rsiPeriod),
      rsiMin: clampInt(b.rsiMin, 5, 95, DEFAULTS.rsiMin),
      rsiMax: clampInt(b.rsiMax, 5, 95, DEFAULTS.rsiMax),
      avoidDoji: Boolean(b.avoidDoji),
      sessions: Array.isArray(b.sessions) ? b.sessions.filter((s) => SESSION_LABELS[s]) : [...DEFAULTS.sessions],
      balance: clamp(b.balance, 50, 1e9, DEFAULTS.balance),
      stakeMode: ['percent', 'fixed'].includes(b.stakeMode) ? b.stakeMode : DEFAULTS.stakeMode,
      stakeValue: clamp(b.stakeValue, 0.5, 1e7, DEFAULTS.stakeValue),
      stakePercent: clamp(b.stakePercent, 0.1, 20, DEFAULTS.stakePercent),
      payout: clampInt(b.payout, 50, 100, DEFAULTS.payout),
      martingale: Boolean(b.martingale),
      mgLevels: clampInt(b.mgLevels, 1, 4, DEFAULTS.mgLevels),
      mgMultiplier: Math.round(clamp(b.mgMultiplier, 1.1, 3, DEFAULTS.mgMultiplier) * 10) / 10,
      dailyLossLimit: clamp(b.dailyLossLimit, 1, 50, DEFAULTS.dailyLossLimit),
      maxTrades: clampInt(b.maxTrades, 1, 50, DEFAULTS.maxTrades),
      notes: String(b.notes || '').slice(0, 400)
    };
    if (out.rsiMin > out.rsiMax) {
      const t = out.rsiMin;
      out.rsiMin = out.rsiMax;
      out.rsiMax = t;
    }
    return out;
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  let state = sanitize(loadDraft() || DEFAULTS);
  const sim = { candles: [], trades: [], stats: null, source: 'cenário sintético', seed: 0 };

  /* ---------------------------- indicadores ---------------------------- */
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (!values.length || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    let value = sum / period;
    out[period - 1] = value;
    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      value = values[i] * k + value * (1 - k);
      out[i] = value;
    }
    return out;
  }

  function rsi(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    gain /= period;
    loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = new Array(values.length).fill(null);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      const mean = sum / period;
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
      const sd = Math.sqrt(variance / period);
      mid[i] = mean;
      upper[i] = mean + mult * sd;
      lower[i] = mean - mult * sd;
    }
    return { mid, upper, lower };
  }

  /* ---------------------------- padrões ---------------------------- */
  const body = (c) => Math.abs(c.close - c.open);
  const range = (c) => c.high - c.low;

  function isDoji(c) {
    const r = range(c);
    return r > 0 && body(c) <= r * 0.1;
  }

  function isBullishEngulfing(prev, cur) {
    return (
      prev.close < prev.open &&
      cur.close > cur.open &&
      cur.open <= prev.close &&
      cur.close >= prev.open &&
      body(cur) > body(prev)
    );
  }

  function isBearishEngulfing(prev, cur) {
    return (
      prev.close > prev.open &&
      cur.close < cur.open &&
      cur.open >= prev.close &&
      cur.close <= prev.open &&
      body(cur) > body(prev)
    );
  }

  function isHammer(c) {
    const b = body(c);
    const r = range(c);
    if (r <= 0 || b <= 0) return false;
    const lower = Math.min(c.open, c.close) - c.low;
    const upper = c.high - Math.max(c.open, c.close);
    return lower >= b * 2 && upper <= b * 0.8 && c.close >= c.open;
  }

  function isShootingStar(c) {
    const b = body(c);
    const r = range(c);
    if (r <= 0 || b <= 0) return false;
    const lower = Math.min(c.open, c.close) - c.low;
    const upper = c.high - Math.max(c.open, c.close);
    return upper >= b * 2 && lower <= b * 0.8 && c.close <= c.open;
  }

  /* ---------------------------- motor de sinais ---------------------------- */
  function buildContext(candles, st) {
    const closes = candles.map((c) => c.close);
    return {
      closes,
      emaTrend: ema(closes, st.trendPeriod),
      rsiValues: rsi(closes, st.rsiPeriod),
      emaFast: ema(closes, 9),
      emaSlow: ema(closes, 21),
      bb: bollinger(closes, 20, 2)
    };
  }

  function rawSignal(st, candles, ind, i) {
    const cur = candles[i];
    const prev = candles[i - 1];
    if (!cur || !prev) return null;

    if (st.strategy === 'engulfing') {
      if (isBullishEngulfing(prev, cur)) return { signal: 'CALL', reason: STRATEGIES.engulfing.codeReasonCall };
      if (isBearishEngulfing(prev, cur)) return { signal: 'PUT', reason: STRATEGIES.engulfing.codeReasonPut };
      return null;
    }

    if (st.strategy === 'hammer') {
      if (isHammer(cur)) return { signal: 'CALL', reason: STRATEGIES.hammer.codeReasonCall };
      if (isShootingStar(cur)) return { signal: 'PUT', reason: STRATEGIES.hammer.codeReasonPut };
      return null;
    }

    if (st.strategy === 'rsiEma') {
      const f = ind.emaFast;
      const s = ind.emaSlow;
      if (![f[i], s[i], f[i - 1], s[i - 1]].every(Number.isFinite)) return null;
      const crossedUp = f[i - 1] <= s[i - 1] && f[i] > s[i];
      const crossedDown = f[i - 1] >= s[i - 1] && f[i] < s[i];
      if (crossedUp && ind.rsiValues[i] >= 45 && ind.rsiValues[i] <= 70) {
        return { signal: 'CALL', reason: STRATEGIES.rsiEma.codeReasonCall };
      }
      if (crossedDown && ind.rsiValues[i] >= 30 && ind.rsiValues[i] <= 55) {
        return { signal: 'PUT', reason: STRATEGIES.rsiEma.codeReasonPut };
      }
      return null;
    }

    if (st.strategy === 'bollinger') {
      const bb = ind.bb;
      if (![bb.lower[i], bb.lower[i - 1], bb.upper[i], bb.upper[i - 1]].every(Number.isFinite)) return null;
      if (ind.closes[i - 1] < bb.lower[i - 1] && ind.closes[i] > bb.lower[i]) {
        return { signal: 'CALL', reason: STRATEGIES.bollinger.codeReasonCall };
      }
      if (ind.closes[i - 1] > bb.upper[i - 1] && ind.closes[i] < bb.upper[i]) {
        return { signal: 'PUT', reason: STRATEGIES.bollinger.codeReasonPut };
      }
      return null;
    }

    if (st.strategy === 'breakout') {
      const lookback = 20;
      if (i < lookback) return null;
      let highest = -Infinity;
      let lowest = Infinity;
      for (let k = i - lookback; k < i; k++) {
        if (candles[k].high > highest) highest = candles[k].high;
        if (candles[k].low < lowest) lowest = candles[k].low;
      }
      if (cur.close > highest) return { signal: 'CALL', reason: STRATEGIES.breakout.codeReasonCall };
      if (cur.close < lowest) return { signal: 'PUT', reason: STRATEGIES.breakout.codeReasonPut };
      return null;
    }

    return null;
  }

  function filterSignal(st, candles, ind, i, raw) {
    if (!raw) return { ok: false, why: 'sem gatilho' };
    if (st.direction === 'call' && raw.signal === 'PUT') return { ok: false, why: 'direção' };
    if (st.direction === 'put' && raw.signal === 'CALL') return { ok: false, why: 'direção' };
    if (st.avoidDoji && isDoji(candles[i])) return { ok: false, why: 'doji' };
    if (st.trendFilter) {
      const e = ind.emaTrend[i];
      if (Number.isFinite(e)) {
        if (raw.signal === 'CALL' && candles[i].close <= e) return { ok: false, why: 'tendência' };
        if (raw.signal === 'PUT' && candles[i].close >= e) return { ok: false, why: 'tendência' };
      }
    }
    if (st.rsiFilter) {
      const r = ind.rsiValues[i];
      if (Number.isFinite(r)) {
        const lo = st.rsiMin;
        const hi = st.rsiMax;
        if (raw.signal === 'CALL' && (r < lo || r > hi)) return { ok: false, why: 'RSI' };
        if (raw.signal === 'PUT' && (r < 100 - hi || r > 100 - lo)) return { ok: false, why: 'RSI' };
      }
    }
    return { ok: true };
  }

  /* ---------------------------- valores derivados ---------------------------- */
  function baseStake(st = sanitize(state)) {
    const raw = st.stakeMode === 'percent' ? (st.balance * st.stakePercent) / 100 : st.stakeValue;
    return Math.max(0.01, round2(raw));
  }

  function riskLadder(st = sanitize(state)) {
    const base = baseStake(st);
    const maxK = st.martingale ? st.mgLevels + 1 : 3;
    const rows = [];
    let lost = 0;
    for (let k = 0; k <= maxK; k++) {
      let stake;
      if (st.martingale && k <= st.mgLevels) stake = round2(base * Math.pow(st.mgMultiplier, k));
      else stake = base;
      rows.push({ k, stake, lost: round2(lost) });
      lost += stake;
    }
    const maxLoss = st.martingale ? round2(rows.slice(0, st.mgLevels + 1).reduce((a, r) => a + r.stake, 0)) : base;
    return { base, rows, maxLoss };
  }

  /* ---------------------------- roteiro ---------------------------- */
  function buildPlaybook(st = sanitize(state)) {
    const meta = STRATEGIES[st.strategy];
    const tfMin = TF_MINUTES[st.timeframe];
    const expiryMin = tfMin * st.expiry;
    const base = baseStake(st);
    const ladder = riskLadder(st);
    const dailyLimit = round2((st.balance * st.dailyLossLimit) / 100);
    const breakeven = 100 / (1 + st.payout / 100);
    const dirLabel =
      st.direction === 'both' ? 'Comprar e vender' : st.direction === 'call' ? 'Somente compra (CALL)' : 'Somente venda (PUT)';
    const sessions = st.sessions.length ? st.sessions.map((s) => SESSION_LABELS[s]).join(' · ') : 'qualquer sessão';
    const L = [];
    const add = (...xs) => L.push(...xs);

    add(
      `# ${st.name}`,
      '',
      `**Ativo:** ${st.asset}  `,
      `**Timeframe:** ${st.timeframe}  `,
      `**Expiração:** ${st.expiry} candle${st.expiry > 1 ? 's' : ''} (${expiryMin} min)  `,
      `**Direção:** ${dirLabel}  `,
      `**Payout mínimo aceito:** ${st.payout}%  `,
      `**Sessões:** ${sessions}`,
      '',
      '> Roteiro para execução **manual** no IQ Option Mobile. Não é recomendação de investimento.',
      '',
      '## 1. Preparação do gráfico'
    );

    const setup = [
      `Abra **${st.asset}** no aplicativo.`,
      `Selecione o timeframe **${st.timeframe}**.`,
      `Confirme que o payout está em **${st.payout}% ou mais**. Se estiver abaixo, não opere.`
    ];
    if (st.trendFilter) {
      setup.push(`Adicione a **EMA de ${st.trendPeriod} períodos** e mantenha visível.`);
    }
    if (st.strategy === 'rsiEma') {
      setup.push('Adicione as **EMAs 9 e 21** e o **RSI 14** (compra: 45–70 · venda: 30–55).');
    } else if (st.rsiFilter) {
      setup.push(
        `Adicione o **RSI de ${st.rsiPeriod} períodos**. Zona de compra: **${st.rsiMin}–${st.rsiMax}**. Para venda, espelhe a zona: **${100 - st.rsiMax}–${100 - st.rsiMin}**.`
      );
    }
    if (st.strategy === 'bollinger') {
      setup.push('Adicione as **Bandas de Bollinger (20, 2)** ao gráfico.');
    }
    setup.forEach((step, index) => add(`${index + 1}. ${step}`));

    add('', '## 2. Checklist antes de cada entrada');
    add('- [ ] O candle anterior já **fechou** (não entre no meio do candle).');
    add(`- [ ] O payout está em **${st.payout}% ou mais**.`);
    if (st.trendFilter) {
      add(`- [ ] O preço está do lado correto da EMA ${st.trendPeriod}: acima para compra, abaixo para venda.`);
    }
    if (st.strategy === 'rsiEma') {
      add('- [ ] RSI entre **45 e 70** para compra e entre **30 e 55** para venda.');
    }
    if (st.rsiFilter) {
      add(
        `- [ ] O RSI${st.strategy === 'rsiEma' ? ' também' : ''} está dentro da zona permitida (${st.rsiMin}–${st.rsiMax} para compra).`
      );
    }
    if (st.avoidDoji) {
      add('- [ ] O candle de sinal **não é um doji** (corpo maior que 10% da amplitude).');
    }
    add(`- [ ] Você fez menos de **${st.maxTrades} entradas** hoje.`);
    add(`- [ ] Você ainda não atingiu o limite de perda de **${money(dailyLimit)}**.`);
    add('- [ ] Não há notícia de alto impacto no minuto (FOMC, CPI, NFP, decisão de juros).');

    add('', '## 3. Gatilho de entrada');
    add(`**Contexto:** ${meta.setup}`, '');
    if (st.direction !== 'put') {
      add(`### Compra (CALL)`, meta.callRule, '', 'Confirmação extra: o candle de sinal deve fechar com corpo saudável, não apenas uma sombra.', '');
    }
    if (st.direction !== 'call') {
      add(`### Venda (PUT)`, meta.putRule, '', 'Confirmação extra: o candle de sinal deve fechar com corpo saudável, não apenas uma sombra.', '');
    }

    add(
      '## 4. Como entrar',
      `- **Valor base:** ${money(base)}${st.stakeMode === 'percent' ? ` (${pct(st.stakePercent)} da banca)` : ''}.`,
      `- **Expiração:** ${expiryMin} minuto${expiryMin > 1 ? 's' : ''} (${st.expiry} candle${st.expiry > 1 ? 's' : ''}).`,
      '- Execute **uma única entrada** imediatamente após o fechamento do candle de sinal.',
      '- Se o preço já andou demais ou o payout caiu, **cancele a entrada**.',
      '',
      '## 5. Gestão de banca'
    );

    if (st.martingale) {
      const stepList = ladder.rows
        .slice(1, st.mgLevels + 1)
        .map((r) => money(r.stake))
        .join(' → ');
      add(
        `- **Martingale ativo:** até ${st.mgLevels} ${st.mgLevels > 1 ? 'níveis' : 'nível'}, multiplicador ${st.mgMultiplier.toFixed(1)}.`,
        `- Sequência de entradas: ${money(base)}${stepList ? ` → ${stepList}` : ''}.`,
        `- **Perda máxima teórica da sequência:** ${money(ladder.maxLoss)} (${pct((ladder.maxLoss / st.balance) * 100)} da banca).`
      );
      if (ladder.maxLoss > dailyLimit) {
        add(`- ⚠️ A escada de martingale **estoura o limite diário** de ${money(dailyLimit)}. Reduza níveis, multiplicador ou valor base.`);
      }
    } else {
      add(
        `- **Sem martingale:** cada perda custa no máximo ${money(base)}; a entrada não aumenta após loss.`,
        `- Perda máxima teórica por sequência: ${money(base)}.`
      );
    }

    add(
      `- **Limite de perda diária:** ${money(dailyLimit)} (${pct(st.dailyLossLimit)} da banca). Ao atingir, **feche o aplicativo**.`,
      `- **Máximo de operações por dia:** ${st.maxTrades}.`,
      `- **Payout de empate:** com ${st.payout}% de payout, você precisa acertar cerca de **${pct(breakeven)}** só para empatar.`,
      '',
      '## 6. Quando não operar',
      '- Fora das sessões escolhidas ou em horário de baixa liquidez.',
      '- Nos 5 minutos antes e depois de notícias de alto impacto.',
      '- Depois de 2 perdas seguidas: pausa de 10 minutos, mesmo que o setup apareça.',
      '- Quando o mercado está em lateralidade extrema (candles pequenos e alternados).',
      '- Se você estiver cansado, ansioso ou tentando recuperar perda.',
      '',
      '## 7. Diário de operações',
      '| Hora | Ativo | Direção | Valor | Resultado | Motivo do sinal | Observação |',
      '|---|---|---|---|---|---|---|',
      '|  |  |  |  |  |  |  |',
      '|  |  |  |  |  |  |  |',
      '|  |  |  |  |  |  |  |',
      '',
      '## 8. Revisão semanal',
      `- Taxa de acerto da semana vs. ponto de empate (${pct(breakeven)}).`,
      '- Quantas entradas fugiram do checklist?',
      '- Qual sessão e qual ativo deram o melhor resultado?',
      '- Se o resultado for negativo por 2 semanas, pare e revise as regras.'
    );

    if (st.notes.trim()) {
      add('', '## Anotações', st.notes.trim());
    }

    add(
      '',
      '---',
      '**Aviso:** opções binárias têm risco elevado e podem ser restritas no seu país. Payout de 80% exige cerca de 55,6% de acerto apenas para empatar. Nenhuma estratégia garante lucro. Use apenas dinheiro que você pode perder.'
    );

    return L.join('\n');
  }

  /* ---------------------------- código ---------------------------- */
  function buildCode(st = sanitize(state)) {
    const expiryMin = (TF_MINUTES[st.timeframe] || 1) * st.expiry;
    const base = baseStake(st);
    const L = [];
    const add = (...xs) => L.push(...xs);

    add(
      '/* ==========================================================',
      `   Script Studio — ${safeComment(st.name)}`,
      `   ${safeComment(st.asset)} · ${st.timeframe} · expiração ${st.expiry} candle(s) (${expiryMin} min)`,
      `   Gerado em ${new Date().toLocaleString('pt-BR')}`,
      '   ----------------------------------------------------------',
      '   Este script APENAS avalia candles fechados e devolve',
      '   "CALL", "PUT" ou null. A execução é manual no aplicativo.',
      '   Não há conexão com conta, API não oficial ou envio de ordens.',
      '   ========================================================== */',
      '',
      'const CONFIG = {',
      `  asset: ${q(st.asset)},`,
      `  timeframe: ${q(st.timeframe)},`,
      `  expiryCandles: ${st.expiry},`,
      `  strategy: ${q(st.strategy)},`,
      `  direction: ${q(st.direction)},`,
      `  payout: ${st.payout},`,
      `  stakeMode: ${q(st.stakeMode)},`,
      `  stakePercent: ${st.stakePercent},`,
      `  // entrada base atual: ${base}`,
      `  stakeValue: ${st.stakeValue},`,
      `  trendFilter: ${st.trendFilter},`,
      `  trendPeriod: ${st.trendPeriod},`,
      `  rsiFilter: ${st.rsiFilter},`,
      `  rsiPeriod: ${st.rsiPeriod},`,
      `  rsiMin: ${st.rsiMin},`,
      `  rsiMax: ${st.rsiMax},`,
      `  avoidDoji: ${st.avoidDoji},`,
      '  // Gestão sugerida — não aplicada automaticamente:',
      `  payoutBreakeven: ${(100 / (1 + st.payout / 100)).toFixed(1)},`,
      `  dailyLossLimitPercent: ${st.dailyLossLimit},`,
      `  maxTradesPerDay: ${st.maxTrades}`,
      '};',
      '',
      '/* ---------- Indicadores ---------- */',
      'function ema(values, period) {',
      '  const out = new Array(values.length).fill(null);',
      '  if (values.length < period) return out;',
      '  let sum = 0;',
      '  for (let i = 0; i < period; i++) sum += values[i];',
      '  let value = sum / period;',
      '  out[period - 1] = value;',
      '  const k = 2 / (period + 1);',
      '  for (let i = period; i < values.length; i++) {',
      '    value = values[i] * k + value * (1 - k);',
      '    out[i] = value;',
      '  }',
      '  return out;',
      '}',
      '',
      'function rsi(values, period) {',
      '  const out = new Array(values.length).fill(null);',
      '  if (values.length <= period) return out;',
      '  let gain = 0;',
      '  let loss = 0;',
      '  for (let i = 1; i <= period; i++) {',
      '    const d = values[i] - values[i - 1];',
      '    if (d >= 0) gain += d;',
      '    else loss -= d;',
      '  }',
      '  gain /= period;',
      '  loss /= period;',
      '  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);',
      '  for (let i = period + 1; i < values.length; i++) {',
      '    const d = values[i] - values[i - 1];',
      '    gain = (gain * (period - 1) + Math.max(d, 0)) / period;',
      '    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;',
      '    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);',
      '  }',
      '  return out;',
      '}',
      '',
      'function bollinger(values, period, mult) {',
      '  period = period || 20;',
      '  mult = mult === undefined ? 2 : mult;',
      '  const mid = new Array(values.length).fill(null);',
      '  const upper = new Array(values.length).fill(null);',
      '  const lower = new Array(values.length).fill(null);',
      '  for (let i = period - 1; i < values.length; i++) {',
      '    let sum = 0;',
      '    for (let j = i - period + 1; j <= i; j++) sum += values[j];',
      '    const mean = sum / period;',
      '    let variance = 0;',
      '    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;',
      '    const sd = Math.sqrt(variance / period);',
      '    mid[i] = mean;',
      '    upper[i] = mean + mult * sd;',
      '    lower[i] = mean - mult * sd;',
      '  }',
      '  return { mid: mid, upper: upper, lower: lower };',
      '}',
      '',
      '/* ---------- Padrões de candle ---------- */',
      'function body(c) { return Math.abs(c.close - c.open); }',
      'function range(c) { return c.high - c.low; }',
      'function isDoji(c) {',
      '  const r = range(c);',
      '  return r > 0 && body(c) <= r * 0.1;',
      '}',
      '',
      'function isBullishEngulfing(prev, cur) {',
      '  return prev.close < prev.open && cur.close > cur.open &&',
      '    cur.open <= prev.close && cur.close >= prev.open &&',
      '    body(cur) > body(prev);',
      '}',
      '',
      'function isBearishEngulfing(prev, cur) {',
      '  return prev.close > prev.open && cur.close < cur.open &&',
      '    cur.open >= prev.close && cur.close <= prev.open &&',
      '    body(cur) > body(prev);',
      '}',
      '',
      'function isHammer(c) {',
      '  const b = body(c);',
      '  const r = range(c);',
      '  if (r <= 0 || b <= 0) return false;',
      '  const lower = Math.min(c.open, c.close) - c.low;',
      '  const upper = c.high - Math.max(c.open, c.close);',
      '  return lower >= b * 2 && upper <= b * 0.8 && c.close >= c.open;',
      '}',
      '',
      'function isShootingStar(c) {',
      '  const b = body(c);',
      '  const r = range(c);',
      '  if (r <= 0 || b <= 0) return false;',
      '  const lower = Math.min(c.open, c.close) - c.low;',
      '  const upper = c.high - Math.max(c.open, c.close);',
      '  return upper >= b * 2 && lower <= b * 0.8 && c.close <= c.open;',
      '}',
      '',
      '/* ---------- Gatilho ---------- */',
      'function evaluate(candles) {',
      '  if (!Array.isArray(candles) || candles.length < 60) return null;',
      '  const closes = candles.map(function (c) { return c.close; });',
      '  const i = candles.length - 1;',
      '  const prev = candles[i - 1];',
      '  const cur = candles[i];',
      '  const emaTrend = ema(closes, CONFIG.trendPeriod);',
      '  const rsiValues = rsi(closes, CONFIG.rsiPeriod);'
    );

    if (st.strategy === 'engulfing') {
      add(
        '',
        '  const signal = isBullishEngulfing(prev, cur) ? "CALL"',
        '    : isBearishEngulfing(prev, cur) ? "PUT" : null;',
        '  const reason = signal === "CALL" ? "Engolfo de alta"',
        '    : signal === "PUT" ? "Engolfo de baixa" : "";'
      );
    } else if (st.strategy === 'hammer') {
      add(
        '',
        '  const signal = isHammer(cur) ? "CALL" : isShootingStar(cur) ? "PUT" : null;',
        '  const reason = signal === "CALL" ? "Martelo"',
        '    : signal === "PUT" ? "Estrela cadente" : "";'
      );
    } else if (st.strategy === 'rsiEma') {
      add(
        '',
        '  const emaFast = ema(closes, 9);',
        '  const emaSlow = ema(closes, 21);',
        '  const crossedUp = emaFast[i - 1] <= emaSlow[i - 1] && emaFast[i] > emaSlow[i];',
        '  const crossedDown = emaFast[i - 1] >= emaSlow[i - 1] && emaFast[i] < emaSlow[i];',
        '  let signal = crossedUp ? "CALL" : crossedDown ? "PUT" : null;',
        '  let reason = signal === "CALL" ? "EMA 9 cruzou acima da 21"',
        '    : signal === "PUT" ? "EMA 9 cruzou abaixo da 21" : "";',
        '  if (signal === "CALL" && (rsiValues[i] < 45 || rsiValues[i] > 70)) { signal = null; reason = ""; }',
        '  if (signal === "PUT" && (rsiValues[i] < 30 || rsiValues[i] > 55)) { signal = null; reason = ""; }'
      );
    } else if (st.strategy === 'bollinger') {
      add(
        '',
        '  const bb = bollinger(closes, 20, 2);',
        '  const signal = closes[i - 1] < bb.lower[i - 1] && closes[i] > bb.lower[i] ? "CALL"',
        '    : closes[i - 1] > bb.upper[i - 1] && closes[i] < bb.upper[i] ? "PUT" : null;',
        '  const reason = signal === "CALL" ? "Reversao na banda inferior"',
        '    : signal === "PUT" ? "Reversao na banda superior" : "";'
      );
    } else {
      add(
        '',
        '  const lookback = 20;',
        '  let highest = -Infinity;',
        '  let lowest = Infinity;',
        '  for (let k = i - lookback; k < i; k++) {',
        '    if (candles[k].high > highest) highest = candles[k].high;',
        '    if (candles[k].low < lowest) lowest = candles[k].low;',
        '  }',
        '  const signal = cur.close > highest ? "CALL" : cur.close < lowest ? "PUT" : null;',
        '  const reason = signal === "CALL" ? "Rompimento de maxima"',
        '    : signal === "PUT" ? "Rompimento de minima" : "";'
      );
    }

    add('', '  if (!signal) return null;', '', '  // ---- Filtros ----');

    if (st.direction !== 'both') {
      add(`  if (CONFIG.direction === ${q(st.direction)}) {`);
      add(`    // só permite ${st.direction === 'call' ? 'compra' : 'venda'}`);
      add(`    if (signal !== ${q(st.direction === 'call' ? 'CALL' : 'PUT')}) return null;`);
      add('  }');
    }

    if (st.avoidDoji) add('  if (CONFIG.avoidDoji && isDoji(cur)) return null;');

    if (st.trendFilter) {
      add(
        '  if (CONFIG.trendFilter && emaTrend[i] !== null) {',
        '    if (signal === "CALL" && cur.close <= emaTrend[i]) return null;',
        '    if (signal === "PUT" && cur.close >= emaTrend[i]) return null;',
        '  }'
      );
    }

    if (st.rsiFilter) {
      add(
        '  if (CONFIG.rsiFilter && rsiValues[i] !== null) {',
        '    if (signal === "CALL" && (rsiValues[i] < CONFIG.rsiMin || rsiValues[i] > CONFIG.rsiMax)) return null;',
        '    if (signal === "PUT" && (rsiValues[i] < 100 - CONFIG.rsiMax || rsiValues[i] > 100 - CONFIG.rsiMin)) return null;',
        '  }'
      );
    }

    add(
      '',
      '  return {',
      '    signal: signal,',
      '    reason: reason,',
      '    candle: i,',
      '    price: cur.close,',
      '    expiresIn: CONFIG.expiryCandles',
      '  };',
      '}',
      '',
      '/* ---------- Exemplo de uso ---------- */',
      '// const sinal = evaluate(candlesFechados);',
      '// if (sinal) console.log(sinal.signal, "-", sinal.reason, "@", sinal.price);',
      '//',
      '// Lembrete: não existe garantia de acerto. O script não executa ordens.',
      ''
    );

    return L.join('\n');
  }

  /* ---------------------------- JSON ---------------------------- */
  function exportConfig() {
    return {
      app: 'script-studio',
      version: 1,
      exportedAt: new Date().toISOString(),
      strategy: sanitize(state)
    };
  }

  /* ---------------------------- simulação ---------------------------- */
  function basePriceFor(asset) {
    const a = String(asset).toUpperCase();
    if (a.includes('BTC')) return 64000;
    if (a.includes('ETH')) return 3100;
    if (a.includes('XAU')) return 2350;
    if (a.includes('JPY')) return 152;
    if (a.includes('BRL')) return 5.4;
    return 1.085;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateCandles(seed, count, st) {
    const rand = mulberry32(seed);
    const startPrice = basePriceFor(st.asset);
    const vol = startPrice >= 1000 ? 0.0032 : startPrice >= 100 ? 0.0009 : 0.00065;
    const tfMin = TF_MINUTES[st.timeframe] || 1;
    const end = Date.now();
    let price = startPrice;
    let drift = 0;
    const candles = [];

    for (let i = 0; i < count; i++) {
      if (i % 40 === 0) drift = (rand() - 0.5) * vol * 0.9;
      const shock = i % 97 === 0 ? (rand() - 0.5) * vol * 7 : 0;
      const open = price;
      const move = drift + (rand() - 0.5) * vol * 1.7 + shock;
      const close = open * (1 + move);
      const wick = Math.abs(move) * (0.4 + rand()) + vol * 0.55;
      const high = Math.max(open, close) * (1 + wick * (0.3 + rand() * 0.7));
      const low = Math.min(open, close) * (1 - wick * (0.3 + rand() * 0.7));
      price = close;
      candles.push({
        time: end - (count - 1 - i) * tfMin * 60000,
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close)
      });
    }
    return candles;
  }

  function maybeRegenerateScenario(prevAsset, prevTimeframe) {
    if (sim.source !== 'cenário sintético') return;
    if (prevAsset === state.asset && prevTimeframe === state.timeframe) return;
    sim.seed = Math.floor(Math.random() * 1e9);
    sim.candles = generateCandles(sim.seed, 340, sanitize(state));
  }

  function parseCsv(text) {
    const lines = String(text)
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) throw new Error('arquivo vazio');

    const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const header = lines[0].split(delim).map((s) => s.trim().toLowerCase());
    const find = (...names) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const idx = {
      open: find('open', 'abertura'),
      high: find('high', 'maxima', 'máxima'),
      low: find('low', 'minima', 'mínima'),
      close: find('close', 'fechamento'),
      time: find('time', 'date', 'data', 'hora', 'timestamp')
    };
    const hasHeader = idx.open >= 0 && idx.high >= 0 && idx.low >= 0 && idx.close >= 0;
    const rows = [];
    const start = hasHeader ? 1 : 0;

    for (let n = start; n < lines.length; n++) {
      const parts = lines[n].split(delim).map((s) => s.trim());
      const cellNum = (s) => num(String(s == null ? '' : s).replace(',', '.'), NaN);
      let open;
      let high;
      let low;
      let close;
      let time = null;

      if (hasHeader) {
        open = cellNum(parts[idx.open]);
        high = cellNum(parts[idx.high]);
        low = cellNum(parts[idx.low]);
        close = cellNum(parts[idx.close]);
        if (idx.time >= 0) time = parts[idx.time] || null;
        if (![open, high, low, close].every(Number.isFinite)) continue;
      } else {
        const nums = parts.map((s) => num(s.replace(',', '.'), NaN)).filter((v) => Number.isFinite(v));
        if (nums.length < 4) continue;
        const ohlc = nums.slice(-4);
        [open, high, low, close] = ohlc;
      }

      if (!(high >= Math.max(open, close) && low <= Math.min(open, close))) continue;
      rows.push({ time, open, high, low, close });
    }

    if (rows.length < 80) {
      throw new Error('preciso de pelo menos 80 candles válidos (use cabeçalho open,high,low,close)');
    }
    return rows.slice(-1000);
  }

  function simulate() {
    const st = sanitize(state);
    const candles = sim.candles;
    if (!candles.length) return;

    const ind = buildContext(candles, st);
    const expiry = st.expiry;
    const initial = st.balance;
    const payout = st.payout;
    const maxLoss = (initial * st.dailyLossLimit) / 100;
    let balance = initial;
    let lossStreak = 0;
    let peak = initial;
    let maxDD = 0;
    let maxLossStreak = 0;
    let blocked = 0;
    const filtered = {};
    const trades = [];
    const equity = [{ i: 0, balance }];

    const warmup = Math.max(
      30,
      st.trendFilter ? st.trendPeriod : 0,
      st.rsiFilter ? st.rsiPeriod : 0,
      21
    );

    for (let i = warmup; i < candles.length - expiry; i++) {
      const raw = rawSignal(st, candles, ind, i);
      if (!raw) continue;
      const check = filterSignal(st, candles, ind, i, raw);
      if (!check.ok) {
        blocked += 1;
        filtered[check.why] = (filtered[check.why] || 0) + 1;
        continue;
      }
      if (trades.length >= st.maxTrades) break;

      const freshBase = Math.max(
        0.01,
        round2(st.stakeMode === 'percent' ? (balance * st.stakePercent) / 100 : st.stakeValue)
      );
      let stake = freshBase;
      if (st.martingale) {
        if (lossStreak > st.mgLevels) {
          lossStreak = 0;
          stake = freshBase;
        } else {
          stake = round2(freshBase * Math.pow(st.mgMultiplier, lossStreak));
        }
      }
      if (stake > balance) stake = round2(balance);
      if (stake <= 0) break;

      const entry = candles[i].close;
      const exit = candles[i + expiry].close;
      const won = raw.signal === 'CALL' ? exit > entry : exit < entry;
      const pnl = won ? round2((stake * payout) / 100) : -stake;

      balance = round2(balance + pnl);
      lossStreak = won ? 0 : lossStreak + 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, peak - balance);

      trades.push({
        index: i,
        signal: raw.signal,
        reason: raw.reason,
        entry,
        exit,
        stake,
        pnl,
        won
      });
      equity.push({ i: i + expiry, balance });

      if (balance <= 0.01 || initial - balance >= maxLoss || trades.length >= st.maxTrades) break;
    }

    const wins = trades.filter((t) => t.won).length;
    const net = round2(balance - initial);
    const stats = {
      trades,
      equity,
      initial,
      finalBalance: balance,
      wins,
      losses: trades.length - wins,
      winRate: trades.length ? (wins / trades.length) * 100 : 0,
      net,
      maxDD: round2(maxDD),
      maxDDpct: initial ? (maxDD / initial) * 100 : 0,
      maxLossStreak,
      blocked,
      filtered,
      breakeven: 100 / (1 + payout / 100),
      expectancy: trades.length ? round2(net / trades.length) : 0
    };

    sim.trades = trades;
    sim.stats = stats;
    $('#chartHint').textContent = `${sim.source} · ${candles.length} candles · ${st.asset}`;
    $('#equityHint').textContent = `${signedMoney(net)} · ${pct(stats.winRate)} de acerto`;
    renderSimStats(stats, st);
    renderTradeTable(trades);
    drawChartsIfVisible();
  }

  function statCard(label, value, sub, cls = '') {
    return `<div class="stat ${cls}"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span><span class="stat-sub">${esc(sub || '')}</span></div>`;
  }

  function renderSimStats(stats, st) {
    const el = $('#simStats');
    if (!stats.trades.length) {
      el.innerHTML =
        statCard('Operações', '0', 'nenhum sinal no cenário') +
        statCard('Resultado', money(0), 'de ' + money(stats.initial)) +
        statCard('Filtros', String(stats.blocked), 'sinais bloqueados') +
        statCard('Payout de empate', pct(stats.breakeven), 'acerto mínimo para empatar', 'warn');
      return;
    }
    const netCls = stats.net > 0 ? 'pos' : stats.net < 0 ? 'neg' : '';
    el.innerHTML = [
      statCard('Operações', String(stats.trades.length), `limite de ${st.maxTrades}/dia`),
      statCard('Acertos', `${stats.wins}/${stats.trades.length}`, pct(stats.winRate), stats.winRate >= stats.breakeven ? 'pos' : 'neg'),
      statCard('Resultado', signedMoney(stats.net), `banca final ${money(stats.finalBalance)}`, netCls),
      statCard('Expectativa', signedMoney(stats.expectancy), 'por operação', stats.expectancy > 0 ? 'pos' : stats.expectancy < 0 ? 'neg' : ''),
      statCard('Drawdown máx.', money(stats.maxDD), pct(stats.maxDDpct) + ' da banca', stats.maxDD > 0 ? 'warn' : ''),
      statCard('Pior sequência', String(stats.maxLossStreak), 'perdas seguidas', stats.maxLossStreak > 2 ? 'neg' : ''),
      statCard('Payout de empate', pct(stats.breakeven), 'acerto mínimo', 'warn'),
      statCard('Filtros', String(stats.blocked), 'sinais bloqueados')
    ].join('');
  }

  function renderTradeTable(trades) {
    const tbody = $('#tradeRows');
    const hint = $('#tradeHint');
    if (!trades.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Nenhum sinal com as regras atuais. Gere outro cenário, relaxe filtros ou importe um CSV.</td></tr>';
      hint.textContent = '0 sinais';
      return;
    }
    const last = trades.slice(-12).reverse();
    tbody.innerHTML = last
      .map((t, k) => {
        const n = trades.length - k;
        return `<tr>
          <td class="mono">${n}</td>
          <td class="mono">${esc(candleLabel(sim.candles[t.index], t.index))}</td>
          <td><span class="tag-dir tag-${t.signal === 'CALL' ? 'call' : 'put'}">${t.signal}</span></td>
          <td>${esc(t.reason)}</td>
          <td class="mono">${formatPrice(t.entry)}</td>
          <td class="mono">${formatPrice(t.exit)}</td>
          <td class="${t.won ? 'tag-win' : 'tag-loss'}">${t.won ? '+' : ''}${money(t.pnl)}</td>
        </tr>`;
      })
      .join('');
    hint.textContent = `${trades.length} sinal${trades.length > 1 ? 's' : ''} · últimos ${last.length}`;
  }

  /* ---------------------------- gráficos ---------------------------- */
  function prepareCanvas(canvas, cssHeight) {
    const width = canvas.clientWidth;
    if (!width) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, cssHeight);
    return { g, width, height: cssHeight };
  }

  function chooseChartWindow(total) {
    if (!sim.trades.length) {
      const visible = Math.min(90, total);
      return { start: total - visible, visible };
    }
    const first = sim.trades[0].index;
    const last = sim.trades[sim.trades.length - 1].index;
    const span = Math.max(10, last - first);
    const pad = 12;
    if (span <= 70) {
      const visible = Math.min(total, Math.max(45, span + pad * 2));
      return { start: Math.max(0, Math.min(total - visible, first - pad)), visible };
    }
    const start = Math.max(0, first - pad);
    return { start, visible: Math.min(total - start, span + pad * 2) };
  }

  function drawCandleChart() {
    const canvas = $('#candleChart');
    if (!canvas) return;
    const size = prepareCanvas(canvas, 300);
    if (!size) return;
    const { g, width, height } = size;
    const candles = sim.candles;
    if (!candles.length) return;

    const st = sanitize(state);
    const visibleCount = chooseChartWindow(candles.length);
    const start = visibleCount.start;
    const visible = visibleCount.visible;
    const slice = candles.slice(start, start + visible);
    const padL = 6;
    const padR = 70;
    const padT = 18;
    const padB = 22;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let lo = Infinity;
    let hi = -Infinity;
    slice.forEach((c) => {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    });
    const span = Math.max(hi - lo, 1e-9);
    lo -= span * 0.07;
    hi += span * 0.07;
    const yOf = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
    const barW = plotW / visible;
    const xOf = (i) => padL + (i - start + 0.5) * barW;

    g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'left';

    for (let k = 0; k <= 4; k++) {
      const price = lo + ((hi - lo) * k) / 4;
      const y = yOf(price);
      g.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(padL, Math.round(y) + 0.5);
      g.lineTo(width - padR, Math.round(y) + 0.5);
      g.stroke();
      g.fillStyle = '#5b6b80';
      g.fillText(formatPrice(price), width - padR + 8, y);
    }

    const bodyW = Math.max(1, Math.min(9, barW * 0.62));
    slice.forEach((c, k) => {
      const cx = xOf(start + k);
      const up = c.close >= c.open;
      g.strokeStyle = up ? 'rgba(52, 211, 153, 0.85)' : 'rgba(251, 113, 133, 0.85)';
      g.fillStyle = up ? 'rgba(52, 211, 153, 0.7)' : 'rgba(251, 113, 133, 0.7)';
      g.lineWidth = Math.max(1, Math.min(1.4, barW * 0.14));
      g.beginPath();
      g.moveTo(cx, yOf(c.high));
      g.lineTo(cx, yOf(c.low));
      g.stroke();
      const top = yOf(Math.max(c.open, c.close));
      const bottom = yOf(Math.min(c.open, c.close));
      g.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
    });

    if (st.trendFilter) {
      const closes = candles.map((c) => c.close);
      const values = ema(closes, st.trendPeriod);
      g.beginPath();
      let started = false;
      for (let i = start; i < candles.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        const x = xOf(i);
        const y = yOf(v);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else {
          g.lineTo(x, y);
        }
      }
      g.strokeStyle = 'rgba(96, 165, 250, 0.75)';
      g.lineWidth = 1.4;
      g.stroke();
    }

    sim.trades.slice(-40).forEach((t) => {
      if (t.index < start) return;
      const cx = xOf(t.index);
      const up = t.signal === 'CALL';
      const yy = up ? yOf(candles[t.index].low) + 12 : yOf(candles[t.index].high) - 12;
      g.beginPath();
      if (up) {
        g.moveTo(cx, yy - 7);
        g.lineTo(cx - 4.5, yy);
        g.lineTo(cx + 4.5, yy);
      } else {
        g.moveTo(cx, yy + 7);
        g.lineTo(cx - 4.5, yy);
        g.lineTo(cx + 4.5, yy);
      }
      g.closePath();
      g.fillStyle = up ? '#34d399' : '#fb7185';
      g.globalAlpha = 0.95;
      g.fill();
      g.globalAlpha = 1;
    });

    const last = candles[candles.length - 1];
    const lastY = yOf(last.close);
    g.setLineDash([3, 4]);
    g.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL, lastY);
    g.lineTo(width - padR, lastY);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = last.close >= last.open ? '#34d399' : '#fb7185';
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.fillText(formatPrice(last.close), width - padR + 8, lastY);

    // legenda
    g.textAlign = 'left';
    g.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
    let legendX = padL + 4;
    if (st.trendFilter) {
      g.fillStyle = 'rgba(96, 165, 250, 0.9)';
      g.fillRect(legendX, 10, 12, 2);
      g.fillStyle = '#8fa3bb';
      g.fillText(`EMA ${st.trendPeriod}`, legendX + 17, 11);
      legendX += 66;
    }
    g.fillStyle = '#8fa3bb';
    g.fillText(`entradas: ${sim.trades.length}`, legendX, 11);

    // eixo x
    g.textAlign = 'center';
    g.fillStyle = '#5b6b80';
    const ticks = Math.min(5, visible);
    for (let k = 0; k < ticks; k++) {
      const idx = start + Math.round((k * (visible - 1)) / Math.max(1, ticks - 1));
      const label = candleLabel(candles[idx], idx);
      const x = xOf(idx);
      if (x < padL + 16 || x > width - padR - 16) continue;
      g.fillText(label, x, height - 7);
    }
  }

  function drawEquityChart() {
    const canvas = $('#equityChart');
    if (!canvas) return;
    const size = prepareCanvas(canvas, 170);
    if (!size) return;
    const { g, width, height } = size;
    const stats = sim.stats;
    if (!stats) return;

    const padL = 86;
    const padR = 14;
    const padT = 14;
    const padB = 18;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const equity = stats.equity;

    g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';

    if (equity.length < 2) {
      g.fillStyle = '#5b6b80';
      g.textAlign = 'center';
      g.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
      g.fillText('Sem operações suficientes para desenhar a curva.', width / 2, height / 2);
      return;
    }

    const balances = equity.map((e) => e.balance);
    let lo = Math.min(...balances, stats.initial);
    let hi = Math.max(...balances, stats.initial);
    const span = Math.max(hi - lo, stats.initial * 0.005);
    lo -= span * 0.15;
    hi += span * 0.15;
    const maxIndex = Math.max(1, equity[equity.length - 1].i);
    const xOf = (i) => padL + (i / maxIndex) * plotW;
    const yOf = (b) => padT + ((hi - b) / (hi - lo)) * plotH;

    g.textAlign = 'right';
    for (let k = 0; k <= 2; k++) {
      const value = lo + ((hi - lo) * k) / 2;
      const y = yOf(value);
      g.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      g.beginPath();
      g.moveTo(padL, Math.round(y) + 0.5);
      g.lineTo(width - padR, Math.round(y) + 0.5);
      g.stroke();
      g.fillStyle = '#5b6b80';
      g.fillText(money(value), padL - 8, y);
    }

    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    g.beginPath();
    g.moveTo(padL, yOf(stats.initial));
    g.lineTo(width - padR, yOf(stats.initial));
    g.stroke();
    g.setLineDash([]);

    g.beginPath();
    equity.forEach((p, k) => {
      const x = xOf(p.i);
      const y = yOf(p.balance);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = stats.net >= 0 ? '#34d399' : '#fb7185';
    g.lineWidth = 1.8;
    g.stroke();

    g.lineTo(xOf(equity[equity.length - 1].i), padT + plotH);
    g.lineTo(xOf(0), padT + plotH);
    g.closePath();
    const fill = g.createLinearGradient(0, padT, 0, padT + plotH);
    if (stats.net >= 0) {
      fill.addColorStop(0, 'rgba(52, 211, 153, 0.22)');
      fill.addColorStop(1, 'rgba(52, 211, 153, 0)');
    } else {
      fill.addColorStop(0, 'rgba(251, 113, 133, 0.2)');
      fill.addColorStop(1, 'rgba(251, 113, 133, 0)');
    }
    g.fillStyle = fill;
    g.fill();
  }

  function drawChartsIfVisible() {
    if (!$('#panel-sim').classList.contains('is-active')) return;
    drawCandleChart();
    drawEquityChart();
    const st = sanitize(state);
    $('#chartHint').textContent = `${sim.source} · ${sim.candles.length} candles · ${st.asset}`;
    if (sim.stats) {
      $('#equityHint').textContent = `${signedMoney(sim.stats.net)} · ${pct(sim.stats.winRate)} de acerto`;
    }
  }

  /* ---------------------------- risco ---------------------------- */
  function renderSummary() {
    const st = sanitize(state);
    const ladder = riskLadder(st);
    const limit = round2((st.balance * st.dailyLossLimit) / 100);
    const base = ladder.base;
    const rows = [
      `<div class="sum-row"><span>Entrada base</span><strong>${money(base)}</strong></div>`,
      `<div class="sum-row"><span>${st.martingale ? `Perda máx. (${st.mgLevels} ${st.mgLevels > 1 ? 'níveis' : 'nível'})` : 'Perda por entrada'}</span><strong>${money(ladder.maxLoss)}</strong></div>`,
      `<div class="sum-row"><span>Limite diário</span><strong>${money(limit)}</strong></div>`,
      `<div class="sum-row"><span>Acerto p/ empatar</span><strong>${pct(100 / (1 + st.payout / 100))}</strong></div>`
    ];
    if (st.martingale && ladder.maxLoss > limit) {
      rows.push(`<div class="sum-warn">A escada de martingale (${money(ladder.maxLoss)}) estoura o limite diário de ${money(limit)}. Reduza níveis, multiplicador ou valor base.</div>`);
    } else {
      rows.push(`<div class="sum-ok">Perda máxima teórica dentro do limite diário definido.</div>`);
    }
    $('#riskSummary').innerHTML = rows.join('');
  }

  function renderRisk() {
    const st = sanitize(state);
    const ladder = riskLadder(st);
    const limit = round2((st.balance * st.dailyLossLimit) / 100);
    const tbody = $('#riskRows');
    tbody.innerHTML = ladder.rows
      .map(
        (r) => `<tr>
          <td class="mono">${r.k}</td>
          <td class="mono">${money(r.stake)}</td>
          <td class="mono ${r.lost > limit ? 'tag-loss' : ''}">${money(r.lost)}</td>
          <td class="mono">${pct((r.lost / st.balance) * 100)}</td>
        </tr>`
      )
      .join('');

    const notes = [];
    notes.push(`<li>Entrada base de <strong>${money(ladder.base)}</strong>${st.stakeMode === 'percent' ? ` (${pct(st.stakePercent)} da banca de ${money(st.balance)})` : ''}.</li>`);
    notes.push(
      `<li>Com payout de <strong>${st.payout}%</strong>, a taxa de acerto de empate é <strong>${pct(100 / (1 + st.payout / 100))}</strong>. Abaixo disso a expectativa é negativa no longo prazo.</li>`
    );
    if (st.martingale) {
      notes.push(
        `<li>Martingale de <strong>${st.mgLevels} ${st.mgLevels > 1 ? 'níveis' : 'nível'}</strong> e multiplicador <strong>${st.mgMultiplier.toFixed(1)}</strong>: perda máxima teórica de <strong>${money(ladder.maxLoss)}</strong> (${pct((ladder.maxLoss / st.balance) * 100)} da banca).</li>`
      );
    } else {
      notes.push('<li>Sem martingale, a perda máxima por sequência é o valor de <strong>uma entrada</strong>. É a configuração mais previsível.</li>');
    }
    notes.push(`<li>Limite diário de <strong>${money(limit)}</strong> (${pct(st.dailyLossLimit)}). Ao atingir, encerre o dia — sem "recuperar" no impulso.</li>`);
    notes.push(`<li>Máximo de <strong>${st.maxTrades} operações</strong> por dia. Menos entradas costuma significar mais seletividade.</li>`);
    notes.push('<li>Reavalie a estratégia a cada 20 operações. Se a taxa de acerto ficar abaixo do empate, pare e ajuste as regras.</li>');
    $('#riskNotes').innerHTML = notes.join('');
  }

  /* ---------------------------- markdown -> html ---------------------------- */
  function inlineMd(text) {
    let s = esc(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }

  function mdToHtml(md) {
    const lines = String(md).split('\n');
    const out = [];
    let list = null;
    let tasks = false;
    let paragraph = [];
    let table = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${paragraph.map(inlineMd).join('<br>')}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (list) {
        if (tasks) out.push('</ul>');
        else out.push(`</${list}>`);
        list = null;
        tasks = false;
      }
    };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table
        .filter((row) => !row.split('|').slice(1, -1).every((cell) => /^:?-{2,}:?$/.test(cell.trim())))
        .map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      if (rows.length) {
        const head = rows.shift();
        const body = rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join('')}</tr>`)
          .join('');
        out.push(
          `<table><thead><tr>${head.map((cell) => `<th>${inlineMd(cell)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
        );
      }
      table = [];
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (line.startsWith('|')) {
        flushParagraph();
        closeList();
        table.push(line);
        continue;
      }
      flushTable();

      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      if (/^---+$/.test(line.trim())) {
        flushParagraph();
        closeList();
        out.push('<hr>');
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
        continue;
      }
      if (/^>\s?/.test(line)) {
        flushParagraph();
        closeList();
        out.push(`<blockquote>${inlineMd(line.replace(/^>\s?/, ''))}</blockquote>`);
        continue;
      }
      const task = line.match(/^-\s+\[[ xX]\]\s+(.*)$/);
      if (task) {
        flushParagraph();
        if (!list || !tasks) {
          closeList();
          out.push('<ul class="tasks">');
          list = 'ul';
          tasks = true;
        }
        out.push(`<li>${inlineMd(task[1])}</li>`);
        continue;
      }
      const bullet = line.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        flushParagraph();
        if (!list || tasks) {
          closeList();
          out.push('<ul>');
          list = 'ul';
          tasks = false;
        }
        out.push(`<li>${inlineMd(bullet[1])}</li>`);
        continue;
      }
      const ordered = line.match(/^\d+\.\s+(.*)$/);
      if (ordered) {
        flushParagraph();
        if (!list || tasks || list !== 'ol') {
          closeList();
          out.push('<ol>');
          list = 'ol';
          tasks = false;
        }
        out.push(`<li>${inlineMd(ordered[1])}</li>`);
        continue;
      }
      paragraph.push(line.trim());
    }

    flushTable();
    flushParagraph();
    closeList();
    return out.join('');
  }

  /* ---------------------------- render ---------------------------- */
  function renderAll() {
    const st = sanitize(state);
    $('#playbookOut').innerHTML = mdToHtml(buildPlaybook(st));
    $('#codeOut').textContent = buildCode(st);
    if (document.activeElement !== $('#jsonEditor')) {
      $('#jsonEditor').value = JSON.stringify(exportConfig(), null, 2);
      $('#jsonStatus').textContent = 'gerado a partir do construtor';
    }
    renderSummary();
    renderRisk();
    updateConditionalUI();
    simulate();
  }

  function updateConditionalUI() {
    const st = sanitize(state);
    $('#rsiOptions').classList.toggle('is-hidden', !st.rsiFilter);
    $('#mgOptions').classList.toggle('is-hidden', !st.martingale);
    $('#stakePercentWrap').classList.toggle('is-hidden', st.stakeMode !== 'percent');
    $('#stakeValueWrap').classList.toggle('is-hidden', st.stakeMode !== 'fixed');
    $('#rsiHint').textContent = `${st.rsiPeriod} · ${st.rsiMin}–${st.rsiMax}`;
  }

  function syncControls() {
    $$('[data-field]').forEach((el) => {
      const key = el.dataset.field;
      if (el.type === 'checkbox') el.checked = Boolean(state[key]);
      else if (el.tagName === 'SELECT') el.value = String(state[key]);
      else el.value = state[key] === undefined || state[key] === null ? '' : String(state[key]);
    });
    $$('[data-seg]').forEach((seg) => {
      const key = seg.dataset.seg;
      seg.querySelectorAll('button').forEach((btn) => {
        const on = String(state[key]) === btn.dataset.value;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    });
    $$('[data-session]').forEach((el) => {
      el.checked = state.sessions.includes(el.dataset.session);
    });
  }

  /* ---------------------------- presets e armazenamento ---------------------------- */
  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(sanitize(state)));
      } catch {
        /* armazenamento indisponível */
      }
    }, 220);
  }

  function refreshPresets(selected) {
    const presets = loadPresets();
    const sel = $('#presetSelect');
    sel.innerHTML = '<option value="">Presets salvos…</option>';
    Object.keys(presets)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
    if (selected && presets[selected]) sel.value = selected;
  }

  /* ---------------------------- toast e clipboard ---------------------------- */
  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  async function copyText(text, message = 'Copiado para a área de transferência') {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
      return;
    } catch {
      /* fallback abaixo */
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast(message);
    } catch {
      toast('Não foi possível copiar');
    }
    area.remove();
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  /* ---------------------------- eventos ---------------------------- */
  function handleField(el) {
    const key = el.dataset.field;
    if (!key) return;
    const prevAsset = state.asset;
    const prevTimeframe = state.timeframe;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number' || el.type === 'range') value = el.value === '' ? 0 : Number(el.value);
    else value = el.value;

    state[key] = value;

    if (key === 'timeframe') {
      refreshExpiryOptions();
    }
    if (key === 'asset' || key === 'timeframe') {
      if (sim.source === 'cenário sintético' && (prevAsset !== state.asset || prevTimeframe !== state.timeframe)) {
        sim.candles = generateCandles(sim.seed, 340, sanitize(state));
      }
    }

    updateConditionalUI();
    saveDraft();
    renderAll();
  }

  function refreshExpiryOptions() {
    const sel = $('#f-expiry');
    const tfMin = TF_MINUTES[state.timeframe] || 1;
    const current = Number(sel.value || state.expiry);
    sel.innerHTML = '';
    for (let n = 1; n <= 5; n++) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `${n} candle${n > 1 ? 's' : ''} · ${n * tfMin} min`;
      sel.appendChild(opt);
    }
    state.expiry = [1, 2, 3, 4, 5].includes(current) ? current : 1;
    sel.value = String(state.expiry);
  }

  function setSegment(key, value) {
    state[key] = value;
    syncControls();
    updateConditionalUI();
    saveDraft();
    renderAll();
  }

  function setupCharts() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => drawChartsIfVisible());
    const c1 = $('#candleChart');
    const c2 = $('#equityChart');
    if (c1) ro.observe(c1);
    if (c2) ro.observe(c2);
  }

  function applyNoticeState() {
    try {
      if (localStorage.getItem(NOTICE_KEY) === 'dismissed') $('#notice').classList.add('is-hidden');
    } catch {
      /* ignora */
    }
  }

  function init() {
    refreshExpiryOptions();
    syncControls();
    refreshPresets();
    applyNoticeState();

    sim.seed = Math.floor(Math.random() * 1e9);
    sim.candles = generateCandles(sim.seed, 340, sanitize(state));
    sim.source = 'cenário sintético';

    renderAll();
    setupCharts();
  }

  /* ---------------------------- ligações ---------------------------- */
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-field]');
    if (el) handleField(el);
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-field]');
    if (el) handleField(el);

    const session = e.target.closest('[data-session]');
    if (session) {
      state.sessions = $$('[data-session]')
        .filter((c) => c.checked)
        .map((c) => c.dataset.session);
      saveDraft();
      renderAll();
    }
  });

  document.addEventListener('click', (e) => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      const seg = segBtn.closest('[data-seg]');
      setSegment(seg.dataset.seg, segBtn.dataset.value);
      return;
    }

    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      const name = tabBtn.dataset.tab;
      $$('[data-tab]').forEach((b) => {
        const on = b === tabBtn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      $$('.tab-panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${name}`));
      if (name === 'sim') requestAnimationFrame(drawChartsIfVisible);
      return;
    }

    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const id = copyBtn.dataset.copy;
      const el = document.getElementById(id);
      let text = '';
      if (id === 'playbookOut') text = buildPlaybook(sanitize(state));
      else if (el) text = el.value !== undefined && el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      copyText(text, id === 'playbookOut' ? 'Roteiro em Markdown copiado' : 'Copiado para a área de transferência');
      return;
    }

    const dlBtn = e.target.closest('[data-download]');
    if (dlBtn) {
      const kind = dlBtn.dataset.download;
      const st = sanitize(state);
      const name = slug(st.name);
      if (kind === 'playbook') download(`${name}-roteiro.md`, buildPlaybook(st), 'text/markdown;charset=utf-8');
      if (kind === 'code') download(`${name}-sinais.js`, buildCode(st), 'text/javascript;charset=utf-8');
      if (kind === 'json') download(`${name}.json`, JSON.stringify(exportConfig(), null, 2), 'application/json;charset=utf-8');
      return;
    }
  });

  $('#btnReset').addEventListener('click', () => {
    if (!window.confirm('Restaurar todas as configurações padrão? O rascunho atual será perdido.')) return;
    const prevAsset = state.asset;
    const prevTimeframe = state.timeframe;
    state = sanitize(DEFAULTS);
    syncControls();
    refreshExpiryOptions();
    maybeRegenerateScenario(prevAsset, prevTimeframe);
    renderAll();
    saveDraft();
    toast('Configurações restauradas');
  });

  $('#noticeClose').addEventListener('click', () => {
    $('#notice').classList.add('is-hidden');
    try {
      localStorage.setItem(NOTICE_KEY, 'dismissed');
    } catch {
      /* ignora */
    }
  });

  $('#btnSavePreset').addEventListener('click', () => {
    const name = sanitize(state).name.trim() || 'Preset sem nome';
    const presets = loadPresets();
    presets[name] = sanitize(state);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
      refreshPresets(name);
      toast(`Preset "${name}" salvo`);
    } catch {
      toast('Não foi possível salvar o preset');
    }
  });

  $('#btnDeletePreset').addEventListener('click', () => {
    const sel = $('#presetSelect');
    const name = sel.value;
    if (!name) {
      toast('Selecione um preset para excluir');
      return;
    }
    const presets = loadPresets();
    delete presets[name];
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
      refreshPresets();
      toast(`Preset "${name}" excluído`);
    } catch {
      toast('Não foi possível excluir');
    }
  });

  $('#presetSelect').addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) return;
    const preset = loadPresets()[name];
    if (!preset) return;
    const prevAsset = state.asset;
    const prevTimeframe = state.timeframe;
    state = sanitize(preset);
    syncControls();
    refreshExpiryOptions();
    maybeRegenerateScenario(prevAsset, prevTimeframe);
    renderAll();
    saveDraft();
    toast(`Preset "${name}" carregado`);
  });

  $('#btnApplyJson').addEventListener('click', () => {
    const text = $('#jsonEditor').value;
    try {
      const data = JSON.parse(text);
      const raw = data && data.strategy ? data.strategy : data;
      if (!raw || typeof raw !== 'object') throw new Error('objeto inválido');
      const prevAsset = state.asset;
      const prevTimeframe = state.timeframe;
      state = sanitize(raw);
      syncControls();
      refreshExpiryOptions();
      maybeRegenerateScenario(prevAsset, prevTimeframe);
      renderAll();
      saveDraft();
      $('#jsonStatus').textContent = 'configuração aplicada';
      toast('JSON aplicado ao construtor');
    } catch (err) {
      $('#jsonStatus').textContent = 'JSON inválido';
      toast(`JSON inválido: ${err.message}`);
    }
  });

  $('#jsonEditor').addEventListener('input', () => {
    $('#jsonStatus').textContent = 'alterações não aplicadas';
  });

  $('#btnSynthetic').addEventListener('click', () => {
    sim.seed = Math.floor(Math.random() * 1e9);
    sim.candles = generateCandles(sim.seed, 340, sanitize(state));
    sim.source = 'cenário sintético';
    simulate();
    requestAnimationFrame(drawChartsIfVisible);
    toast('Novo cenário sintético gerado');
  });

  $('#csvInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const candles = parseCsv(String(reader.result || ''));
        sim.candles = candles;
        sim.source = 'CSV importado';
        simulate();
        requestAnimationFrame(drawChartsIfVisible);
        toast(`${candles.length} candles importados`);
      } catch (err) {
        toast(`CSV inválido: ${err.message}`);
      }
    };
    reader.onerror = () => toast('Não foi possível ler o arquivo');
    reader.readAsText(file);
  });

  window.addEventListener('resize', () => drawChartsIfVisible());

  init();
})();
