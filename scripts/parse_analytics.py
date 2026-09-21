#!/usr/bin/env python3
"""Read a LinkedIn "AggregateAnalytics" .xlsx export and print a clean summary
the Strategy Analyst can read. Pure standard library — no pip install needed.

Get the file from LinkedIn: Profile -> Analytics -> Export -> pick a date range.

Usage:
    python scripts/parse_analytics.py [path/to/AggregateAnalytics.xlsx]

With no path, it grabs the newest AggregateAnalytics*.xlsx from the current
folder or your ~/Downloads.
"""
import sys, os, glob, zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def find_file():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cands = []
    for d in ('.', os.path.expanduser('~/Downloads')):
        cands += glob.glob(os.path.join(d, 'AggregateAnalytics*.xlsx'))
    if not cands:
        sys.exit("No AggregateAnalytics*.xlsx found. Pass the path:\n"
                 "  python scripts/parse_analytics.py <file>")
    return max(cands, key=os.path.getmtime)


def read_sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = {x.get('Id'): x.get('Target') for x in rels}
    sheets = []
    for s in wb.find(NS + 'sheets'):
        target = relmap.get(s.get(REL + 'id'))
        if target and not target.startswith('xl/'):
            target = 'xl/' + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(NS + 'row'):
            vals = []
            for c in row.findall(NS + 'c'):
                v = c.find(NS + 'v')
                val = ''
                if v is not None:
                    val = v.text
                    if c.get('t') == 's':
                        val = shared[int(val)]
                vals.append(val)
            rows.append(vals)
        sheets.append((s.get('name'), rows))
    return sheets


def main():
    path = find_file()
    print(f"# LinkedIn analytics — {os.path.basename(path)}\n")
    for name, rows in read_sheets(path):
        print(f"## {name}")
        for r in rows[:60]:
            cells = [c for c in r if c not in (None, '')]
            if cells:
                print(" | ".join(cells))
        print()


if __name__ == '__main__':
    main()
