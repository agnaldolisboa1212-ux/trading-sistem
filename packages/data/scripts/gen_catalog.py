"""Gera packages/data/src/catalog.ts a partir do public-apis README ja parseado.

Cada entrada recebe:
  - id           slug estavel usado como chave no registry
  - capabilities o que a API sabe entregar (ohlc, fx-rate, crypto-spot, macro...)
  - assetClasses que classes de ativo cobre
  - requiresKey  derivado do campo `auth` do public-apis
"""
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'public-apis-finance.json')
OUT = os.path.join(HERE, '..', 'src', 'catalog.ts')

cat = json.load(open(SRC, encoding='utf-8'))

# --- classificacao por palavras-chave sobre nome + descricao -----------------
RULES = [
    (r'ohlc|candle|historical (stock|price|market)|end of day|eod|time series|intraday|market data|stock market|stock data|historical data', 'ohlc'),
    (r'stock|equit|share price|ticker|nasdaq|nyse|index|indices', 'equities'),
    (r'forex|currency|exchange rate|fx |foreign exchange', 'fx-rate'),
    (r'crypto|bitcoin|ethereum|btc|altcoin|digital currency|coin', 'crypto-spot'),
    (r'economic|macro|treasury|federal reserve|central bank|inflation|gdp', 'macro'),
    (r'news|headline|sentiment|social|reddit|wallstreetbets|twitter', 'news-sentiment'),
    (r'blockchain|on-?chain|ethereum node|rpc|explorer|mempool|wallet address', 'onchain'),
    (r'filing|sec |edgar|10-k|prospectus|regulatory', 'filings'),
    (r'fundamental|earnings|balance sheet|financial statement|ratio', 'fundamentals'),
    (r'bank|payment|invoice|billing|accounting|iban|vat|tax|boleto|checkout', 'banking-payments'),
    (r'broker|trading|order|execution|portfolio', 'brokerage'),
    (r'gold|silver|metal|commodit', 'metals'),
]

ASSET_RULES = [
    (r'forex|currency|exchange rate|fx |foreign exchange', 'forex'),
    (r'stock|equit|index|indices|nasdaq|nyse|share', 'index'),
    (r'crypto|bitcoin|ethereum|btc|coin|altcoin', 'crypto'),
    (r'gold|silver|metal', 'metal'),
    (r'commodit|oil|energy', 'commodity'),
]

# Overrides para as fontes que realmente alimentam o motor MMXM/SMT.
# capabilities explicitas + prioridade no failover (menor = tentado primeiro).
OVERRIDES = {
    'yahoo-finance': dict(caps=['ohlc', 'equities', 'fx-rate', 'metals', 'crypto-spot', 'index'],
                          assets=['forex', 'index', 'metal', 'crypto', 'commodity'],
                          adapter='yahoo', priority=1,
                          note='Fonte primaria de OHLC diario/semanal. O adapter usa o endpoint publico query1.finance.yahoo.com/v8/finance/chart (sem chave); a entrada do catalogo refere o servico pago equivalente.'),
    'twelve-data': dict(caps=['ohlc', 'equities', 'fx-rate', 'crypto-spot', 'index'],
                        assets=['forex', 'index', 'metal', 'crypto'],
                        adapter='twelvedata', priority=2,
                        note='Cobertura ampla e OHLC consistente. Free tier 800 req/dia.'),
    'alpha-vantage': dict(caps=['ohlc', 'equities', 'fx-rate', 'crypto-spot', 'fundamentals'],
                          assets=['forex', 'index', 'crypto'],
                          adapter='alphavantage', priority=3,
                          note='Free tier 25 req/dia — usar apenas como failover.'),
    'polygon': dict(caps=['ohlc', 'equities', 'fx-rate', 'crypto-spot'],
                    assets=['forex', 'index', 'crypto'],
                    adapter='polygon', priority=4,
                    note='Dados de alta qualidade; free tier limitado a fim de dia.'),
    'finnhub': dict(caps=['ohlc', 'equities', 'fx-rate', 'crypto-spot', 'news-sentiment', 'fundamentals'],
                    assets=['forex', 'index', 'crypto'],
                    adapter='finnhub', priority=5,
                    note='Bom para noticias e sentimento alem de OHLC.'),
    'financial-modeling-prep': dict(caps=['ohlc', 'equities', 'fundamentals', 'fx-rate'],
                                    assets=['forex', 'index'],
                                    adapter='fmp', priority=6, note='Fundamentals ricos.'),
    'eod-historical-data': dict(caps=['ohlc', 'equities', 'fx-rate', 'index'],
                                assets=['forex', 'index', 'metal'],
                                adapter=None, priority=7, note='Historico longo, pago.'),
    'marketstack': dict(caps=['ohlc', 'equities', 'index'], assets=['index'],
                        adapter=None, priority=8, note='EOD de acoes e indices.'),
    'deriv': dict(caps=['ohlc', 'fx-rate', 'metals', 'crypto-spot', 'index', 'brokerage'],
                  assets=['forex', 'index', 'metal', 'crypto'],
                  adapter='deriv', priority=2,
                  note='ticks_history NAO exige token — dados de mercado publicos. '
                       'Cobre forex spot, metais, cripto, indices OTC e sinteticos 24/7. '
                       'A conta (saldo, portfolio, ordens) exige token com scope adequado.'),
    'binance': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'],
                    adapter='binance', priority=1,
                    note='Klines publicos sem chave — fonte primaria de cripto.'),
    'coingecko': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'],
                      adapter='coingecko', priority=2,
                      note='OHLC diario sem chave, rate limit generoso.'),
    'coinbase': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'],
                     adapter='coinbase', priority=3, note='Candles publicos por produto.'),
    'kraken': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'],
                   adapter='kraken', priority=4, note='OHLC publico sem chave.'),
    'bitfinex': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'],
                     adapter=None, priority=5, note='Candles publicos v2.'),
    'cryptocompare': dict(caps=['ohlc', 'crypto-spot', 'news-sentiment'], assets=['crypto'],
                          adapter=None, priority=6, note='Historico diario agregado.'),
    'coincap': dict(caps=['crypto-spot'], assets=['crypto'], adapter=None, priority=7, note=''),
    'coinpaprika': dict(caps=['ohlc', 'crypto-spot'], assets=['crypto'], adapter=None, priority=8, note=''),
    'frankfurter': dict(caps=['fx-rate'], assets=['forex'], adapter='frankfurter', priority=1,
                        note='Taxas diarias do BCE, sem chave. Serve para reconstruir DXY sintetico.'),
    'exchangerate-host': dict(caps=['fx-rate'], assets=['forex'], adapter='exchangeratehost',
                              priority=2, note='Serie temporal FX gratuita.'),
    'currency-api': dict(caps=['fx-rate'], assets=['forex'], adapter=None, priority=3,
                         note='Espelho em CDN, sem chave e sem rate limit.'),
    'exchangerate-api': dict(caps=['fx-rate'], assets=['forex'], adapter=None, priority=4, note=''),
    'fixer': dict(caps=['fx-rate'], assets=['forex'], adapter=None, priority=5, note=''),
    'currencylayer': dict(caps=['fx-rate'], assets=['forex'], adapter=None, priority=6, note=''),
    'fred': dict(caps=['macro'], assets=[], adapter='fred', priority=1,
                 note='DXY, taxas de juro, curva — contexto macro do vies HTF.'),
    'fed-treasury': dict(caps=['macro'], assets=[], adapter=None, priority=2,
                         note='Yields do Tesouro US, sem chave.'),
    'econdb': dict(caps=['macro'], assets=[], adapter=None, priority=3, note=''),
    'sec-edgar-data': dict(caps=['filings', 'fundamentals'], assets=['index'], adapter=None,
                           priority=1, note='Filings oficiais, sem chave.'),
    'goldprice-dev': dict(caps=['metals'], assets=['metal'], adapter=None, priority=1,
                          note='Preco spot de ouro.'),
    'wallstreetbets': dict(caps=['news-sentiment'], assets=['index'], adapter=None, priority=1,
                           note='Sentimento retail — usado como contra-indicador.'),
}


def slug(name: str) -> str:
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s


def classify(name: str, desc: str, section: str):
    text = f'{name} {desc}'.lower()
    caps = {c for pat, c in RULES if re.search(pat, text)}
    assets = {a for pat, a in ASSET_RULES if re.search(pat, text)}
    if section == 'Cryptocurrency':
        caps.add('crypto-spot')
        assets.add('crypto')
    if section == 'Currency Exchange':
        caps.add('fx-rate')
        assets.add('forex')
    if section == 'Blockchain':
        caps.add('onchain')
    if not caps:
        caps.add('reference')
    return sorted(caps), sorted(assets)


def requires_key(auth: str) -> bool:
    a = auth.strip().lower().replace('`', '')
    return a not in ('', 'no')


def ts(v):
    return json.dumps(v, ensure_ascii=False)


entries = []
seen = set()
for section, items in cat.items():
    for it in items:
        sid = slug(it['name'])
        if sid in seen:
            continue
        seen.add(sid)
        caps, assets = classify(it['name'], it['description'], section)
        ov = OVERRIDES.get(sid, {})
        entries.append({
            'id': sid,
            'name': it['name'],
            'url': it['url'],
            'description': it['description'],
            'category': section,
            'auth': it['auth'].replace('`', '') or 'No',
            'https': it['https'].strip().lower() == 'yes',
            'cors': it['cors'].strip().lower(),
            'requiresKey': requires_key(it['auth']),
            'capabilities': ov.get('caps', caps),
            'assetClasses': ov.get('assets', assets),
            'adapter': ov.get('adapter'),
            'priority': ov.get('priority', 99),
            'note': ov.get('note', ''),
        })

entries.sort(key=lambda e: (e['category'], e['priority'], e['name'].lower()))

header = '''/**
 * Catalogo COMPLETO das APIs publicas de financas.
 *
 * ESTE FICHEIRO E GERADO. Fonte: https://github.com/public-apis/public-apis
 * secoes Finance, Cryptocurrency, Currency Exchange e Blockchain.
 * Regenerar com: npm run catalog:sync -w @trading/data
 *
 * Nem toda API do catalogo tem um adapter implementado — `adapter` indica qual
 * implementacao em `src/providers/` a serve. As restantes ficam registadas como
 * fontes conhecidas e disponiveis (auth, capacidades, classes de ativo), prontas
 * a ligar sem ter de voltar ao README do public-apis.
 */

export type Capability =
  | 'ohlc'
  | 'equities'
  | 'index'
  | 'fx-rate'
  | 'crypto-spot'
  | 'metals'
  | 'macro'
  | 'fundamentals'
  | 'filings'
  | 'news-sentiment'
  | 'onchain'
  | 'brokerage'
  | 'banking-payments'
  | 'reference';

export type CatalogAssetClass = 'forex' | 'index' | 'metal' | 'crypto' | 'commodity';

export interface CatalogEntry {
  /** Slug estavel usado como chave no registry. */
  id: string;
  name: string;
  url: string;
  description: string;
  /** Secao de origem no public-apis. */
  category: 'Finance' | 'Cryptocurrency' | 'Currency Exchange' | 'Blockchain';
  /** Tipo de autenticacao exigido, tal como documentado no public-apis. */
  auth: string;
  https: boolean;
  cors: string;
  requiresKey: boolean;
  capabilities: Capability[];
  assetClasses: CatalogAssetClass[];
  /** Nome do adapter em src/providers que implementa esta fonte, se existir. */
  adapter: string | null;
  /** Ordem de tentativa no failover dentro da mesma capacidade (menor = antes). */
  priority: number;
  note: string;
}

export const API_CATALOG: readonly CatalogEntry[] = Object.freeze([
'''

body = []
for e in entries:
    body.append('  {\n' + '\n'.join(
        f'    {k}: {ts(v)},' for k, v in e.items()
    ) + '\n  },')

footer = ''']);

/** Total de fontes catalogadas. */
export const CATALOG_SIZE = API_CATALOG.length;

/** Fontes que ja tem adapter implementado e podem servir dados agora. */
export const IMPLEMENTED_SOURCES = API_CATALOG.filter((e) => e.adapter !== null);

/** Procura por capacidade, ordenado por prioridade de failover. */
export function sourcesFor(capability: Capability, assetClass?: CatalogAssetClass): CatalogEntry[] {
  return API_CATALOG.filter(
    (e) =>
      e.capabilities.includes(capability) &&
      (assetClass === undefined || e.assetClasses.includes(assetClass)),
  ).sort((a, b) => a.priority - b.priority);
}

/** Fontes utilizaveis sem qualquer chave de API. */
export function keylessSources(capability?: Capability): CatalogEntry[] {
  return API_CATALOG.filter(
    (e) => !e.requiresKey && (capability === undefined || e.capabilities.includes(capability)),
  );
}

export function findSource(id: string): CatalogEntry | undefined {
  return API_CATALOG.find((e) => e.id === id);
}
'''

open(OUT, 'w', encoding='utf-8').write(header + '\n'.join(body) + '\n' + footer)
print(f'gerado {OUT} com {len(entries)} fontes')
by_cap = {}
for e in entries:
    for c in e['capabilities']:
        by_cap[c] = by_cap.get(c, 0) + 1
for c, n in sorted(by_cap.items(), key=lambda x: -x[1]):
    print(f'  {c}: {n}')
print('com adapter:', sum(1 for e in entries if e['adapter']))
print('sem chave:', sum(1 for e in entries if not e['requiresKey']))
