"""Génère www/docs/fiche-animation-1-animateur.pdf depuis docs/fiche-animation-1-animateur.html
Usage : python3 scripts/fiche-pdf.py   (nécessite : pip install playwright && playwright install chromium)"""
from pathlib import Path
from playwright.sync_api import sync_playwright

racine = Path(__file__).resolve().parent.parent
source = racine / 'docs' / 'fiche-animation-1-animateur.html'
sortie = racine / 'www' / 'docs' / 'fiche-animation-1-animateur.pdf'
pied = ('<div style="font-size:7px;color:#5b6470;width:100%;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif">'
        '<span>Kit Livre Augmenté · biblio.gironde · bibliogironde.github.io/Kit-AR-Livre-Augmente</span>'
        '<span>Fiche animation · 1 animateur · page <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>')
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(source.as_uri())
    pg.wait_for_timeout(300)
    pg.pdf(path=str(sortie), format='A4', print_background=True, prefer_css_page_size=True,
           display_header_footer=True, header_template='<div></div>', footer_template=pied,
           margin={'top': '16mm', 'bottom': '16mm', 'left': '15mm', 'right': '15mm'})
    b.close()
print(sortie, sortie.stat().st_size // 1024, 'Ko')
