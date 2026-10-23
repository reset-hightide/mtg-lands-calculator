"""
Builds the web assets from the TCC workbook ("land prediction_CMC and ramps only.xlsx").

Stdlib only (no pandas/openpyxl): the .xlsx is read straight from its XML.

Outputs (in ../data):
  decks.csv                the 39,287 enriched decks used by the final model (readable table)
  validation_sample.json   random decks with their text, to test the card rules / archetype / model
  model_fit.json           MDFC weights + OLS refit of eq. (12) vs. the coefficients published in the TCC

usage: python -I build_data.py "<path to xlsx>"
"""
import sys, zipfile, csv, json, random, datetime, os
import xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- read
z = zipfile.ZipFile(sys.argv[1])
sst = []
for ev, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
    if el.tag == M + 'si':
        sst.append(''.join(t.text or '' for t in el.iter(M + 't')))
        el.clear()

rows = []
for ev, el in ET.iterparse(z.open('xl/worksheets/sheet1.xml')):
    if el.tag != M + 'row':
        continue
    if int(el.get('r')) > 1:
        d = {}
        for c in el.findall(M + 'c'):
            col = ''.join(ch for ch in c.get('r') if ch.isalpha())
            v = c.find(M + 'v')
            if v is not None:
                d[col] = sst[int(v.text)] if c.get('t') == 's' else v.text
        # final modelling base: decklist text scraped AND colors filled (39,287 decks in the TCC)
        if d.get('B') and d.get('W'):
            rows.append(d)
    el.clear()
print('rows in modelling base:', len(rows))


def num(d, k, default=0.0):
    try:
        return float(d.get(k, default))
    except (TypeError, ValueError):
        return default


def iso(serial):
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(serial)))).isoformat()


def cab_of(text):
    t = text.replace('\r', '').lower()
    i = t.find('tournament standings')
    return t[:i] if i >= 0 else t


# ---------------------------------------------------------------- MDFC weights (TCC eqs. 3-5)
def ols(X, y, intercept=True):
    """Ordinary least squares via normal equations (Gauss-Jordan). Returns coefs, r2."""
    k = len(X[0]) + (1 if intercept else 0)
    A = [[0.0] * k for _ in range(k)]
    b = [0.0] * k
    for xi, yi in zip(X, y):
        v = ([1.0] if intercept else []) + list(xi)
        for i in range(k):
            b[i] += v[i] * yi
            for j in range(i, k):
                A[i][j] += v[i] * v[j]
    for i in range(k):
        for j in range(i):
            A[i][j] = A[j][i]
    n = k
    aug = [A[i][:] + [b[i]] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(aug[r][c]))
        aug[c], aug[p] = aug[p], aug[c]
        piv = aug[c][c]
        aug[c] = [x / piv for x in aug[c]]
        for r in range(n):
            if r != c and aug[r][c]:
                f = aug[r][c]
                aug[r] = [x - f * y_ for x, y_ in zip(aug[r], aug[c])]
    beta = [aug[i][n] for i in range(n)]
    ybar = sum(y) / len(y)
    sst_ = sum((v - ybar) ** 2 for v in y)
    sse = 0.0
    for xi, yi in zip(X, y):
        v = ([1.0] if intercept else []) + list(xi)
        sse += (yi - sum(a * c for a, c in zip(beta, v))) ** 2
    return beta, 1 - sse / sst_


for d in rows:
    d['_cmc'] = num(d, 'G'); d['_lands'] = num(d, 'F')
    d['_non'] = num(d, 'H'); d['_myth'] = num(d, 'I')
    d['_draw'] = num(d, 'K'); d['_ramp'] = num(d, 'L'); d['_comp'] = num(d, 'P')
    d['_nc'] = num(d, 'X')

zero = [d for d in rows if d['_non'] + d['_myth'] == 0]
with_m = [d for d in rows if d['_non'] + d['_myth'] > 0]
base_beta, base_r2 = ols([[d['_cmc'], d['_draw'] + d['_ramp']] for d in zero], [d['_lands'] for d in zero])
diff, Xm = [], []
for d in with_m:
    pred = base_beta[0] + base_beta[1] * d['_cmc'] + base_beta[2] * (d['_draw'] + d['_ramp'])
    diff.append(pred - d['_lands'])
    Xm.append([d['_non'], d['_myth']])
(w_non, w_myth), _ = ols(Xm, diff, intercept=False)
print('MDFC weights (own refit): non-mythic %.4f  mythic %.4f   [Karsten: 0.38 / 0.74]' % (w_non, w_myth))

WEIGHT_NON, WEIGHT_MYTH = 0.38, 0.74   # Karsten (2022); own refit on this base is printed above for comparison
for d in rows:
    d['_lm'] = d['_lands'] + WEIGHT_NON * d['_non'] + WEIGHT_MYTH * d['_myth']

# ---------------------------------------------------------------- refit of eq. (12)
ARCH = ['Aggro', 'Combo', 'Control', 'Lands', 'Ramp', 'Tempo']
NAMES = (['Intercept', 'CMC', 'Cheap_draw', 'Cheap_ramp', 'Companion', 'Quantity_of_colors'] + ARCH
         + ['Colors*' + a for a in ARCH])


def features(cmc, draw, ramp, comp, nc, arch):
    dm = [1.0 if arch == a else 0.0 for a in ARCH]
    return [cmc, draw, ramp, comp, nc] + dm + [nc * x for x in dm]


X = [features(d['_cmc'], d['_draw'], d['_ramp'], d['_comp'], d['_nc'], d['V']) for d in rows]
y = [d['_lm'] for d in rows]
beta, r2 = ols(X, y)

PAPER = [20.2185, 1.4316, -0.2283, -0.2304, 0.0364, 0.6391, 0.0937, -2.1148, 0.3099, 12.6260, 4.4410, -0.3831,
         -0.6748, 0.7114, -0.2602, -3.0869, -1.1077, -0.2844]


def metrics(coefs):
    err = []
    for xi, yi in zip(X, y):
        p = coefs[0] + sum(c * v for c, v in zip(coefs[1:], xi))
        err.append(yi - p)
    ybar = sum(y) / len(y)
    ss = sum((v - ybar) ** 2 for v in y)
    return {'r2': 1 - sum(e * e for e in err) / ss, 'mae': sum(abs(e) for e in err) / len(err),
            'rmse': (sum(e * e for e in err) / len(err)) ** 0.5}


fit = {
    'n': len(rows),
    'mdfc_weights_refit': {'nonmythic': w_non, 'mythic': w_myth},
    'mdfc_weights_karsten': {'nonmythic': 0.38, 'mythic': 0.74},
    'refit': dict(zip(NAMES, beta)),
    'paper': dict(zip(NAMES, PAPER)),
    'refit_metrics': {'r2': r2, **{k: v for k, v in metrics(beta).items() if k != 'r2'}},
    'paper_metrics_on_all_data': metrics(PAPER),
}
json.dump(fit, open(os.path.join(OUT, 'model_fit.json'), 'w', encoding='utf-8'), indent=1)
print('R2 refit %.4f | paper coefficients on all data: %s' % (r2, fit['paper_metrics_on_all_data']))
for n_, a, b_ in zip(NAMES, beta, PAPER):
    print('  %-26s refit % .4f   paper % .4f' % (n_, a, b_))

# ---------------------------------------------------------------- decks.csv
cols = ['deck_url', 'source', 'format', 'event_date', 'total_cards', 'lands', 'cmc', 'nonmythic_mdfc', 'mythic_mdfc',
        'cheap_draw', 'cheap_ramp', 'companion', 'wins', 'losses', 'archetype', 'colors', 'n_colors', 'lands_mdfc']
with open(os.path.join(OUT, 'decks.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(cols)
    for d in rows:
        w.writerow([d.get('A', ''), d.get('D', ''), d.get('O', ''), iso(d['N']) if d.get('N') else '',
                    int(num(d, 'E')), int(d['_lands']), round(d['_cmc'], 4), int(d['_non']), int(d['_myth']),
                    int(d['_draw']), int(d['_ramp']), int(d['_comp']), int(num(d, 'S')), int(num(d, 'T')),
                    d.get('V', ''), d.get('W', ''), int(d['_nc']), round(d['_lm'], 4)])
print('wrote decks.csv', os.path.getsize(os.path.join(OUT, 'decks.csv')) // 1024, 'KB')

# ---------------------------------------------------------------- validation sample
random.seed(20260422)
sample = random.sample(rows, 400)
out = []
for d in sample:
    cab = cab_of(d['B'])
    lines = d['B'].replace('\r', '').split('\n')
    out.append({
        'url': d.get('A'), 'name': lines[9] if len(lines) > 9 else '', 'cab': cab, 'topo': cab[:400],
        'text': d['B'].replace('\r', '').split('Tournament Standings')[0],
        'expected': {'lands': d['_lands'], 'cmc': d['_cmc'], 'nonmythic': d['_non'], 'mythic': d['_myth'],
                     'draw': d['_draw'], 'ramp': d['_ramp'], 'companion': d['_comp'], 'archetype': d['V'],
                     'colors': d['W'], 'n_colors': d['_nc'], 'lands_mdfc': d['_lm']},
    })
json.dump(out, open(os.path.join(OUT, 'validation_sample.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('wrote validation_sample.json', os.path.getsize(os.path.join(OUT, 'validation_sample.json')) // 1024, 'KB')
