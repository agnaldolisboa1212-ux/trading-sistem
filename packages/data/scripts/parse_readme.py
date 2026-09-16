"""Extrai as secoes financeiras do README do public-apis para JSON.

Entrada : scripts/public-apis.md  (baixado por `npm run catalog:sync`)
Saida   : scripts/public-apis-finance.json

Depois deste script corre gen_catalog.py, que transforma o JSON em catalog.ts.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'public-apis.md')
OUT = os.path.join(HERE, 'public-apis-finance.json')

WANTED = ['Finance', 'Cryptocurrency', 'Currency Exchange', 'Blockchain']

ROW = re.compile(
    r'^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|'
)


def main() -> None:
    lines = open(SRC, encoding='utf-8').read().splitlines()

    sections: dict[str, list[str]] = {}
    current: str | None = None
    for ln in lines:
        if ln.startswith('### '):
            current = ln[4:].strip()
            sections[current] = []
        elif current and ln.startswith('|') and not ln.startswith('|---') and not ln.startswith('| API'):
            sections[current].append(ln)

    catalog: dict[str, list[dict]] = {}
    total = 0
    for name in WANTED:
        items = []
        for ln in sections.get(name, []):
            m = ROW.match(ln)
            if not m:
                continue
            items.append({
                'name': m.group(1),
                'url': m.group(2),
                'description': m.group(3),
                'auth': m.group(4),
                'https': m.group(5),
                'cors': m.group(6),
            })
        catalog[name] = items
        total += len(items)
        print(f'{name}: {len(items)}')

    if total == 0:
        raise SystemExit('nenhuma API extraida — o formato do README mudou?')

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(catalog, fh, indent=2, ensure_ascii=False)
    print(f'TOTAL {total} -> {OUT}')


if __name__ == '__main__':
    main()
