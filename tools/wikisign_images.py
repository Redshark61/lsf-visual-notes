#!/usr/bin/env python3
"""
Illustrations des configurations de main depuis Wikisign LSF (CC BY-SA 2.0 fr).

  download : télécharge chaque image dans un dossier de transit (vide) et relève l'attribution.
  install  : revérifie les fichiers, les copie dans public/, renseigne imageUrl dans le catalogue
             et écrit le fichier de crédits.

Exemples :
  python3 -I tools/wikisign_images.py download --catalog public/data/handshapes-catalog.json --staging /tmp/wikisign-staging
  python3 -I tools/wikisign_images.py install  --catalog public/data/handshapes-catalog.json --staging /tmp/wikisign-staging \
      --dest public/icons/handshapes/wikisign
"""
import argparse
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://lsf.wikisign.org"
LICENSE = "CC BY-SA 2.0 fr"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/2.0/fr/"
USER_AGENT = "lsf-visual-notes/0.1 (script de construction du catalogue)"
MAX_BYTES = 500_000
DELAY_S = 0.5  # politesse envers le serveur
SIGNATURES = {b"\xff\xd8\xff": "jpg", b"\x89PNG\r\n\x1a\n": "png", b"GIF87a": "gif", b"GIF89a": "gif"}
ID_PATTERN = re.compile(r"^hand_[a-z0-9_]+$")


def fetch(url: str, max_bytes: int = 2_000_000) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as res:
        data = res.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError(f"réponse trop volumineuse ({url})")
        return data, res.headers.get("Content-Type", "")


def sniff(data: bytes) -> str | None:
    return next((ext for sig, ext in SIGNATURES.items() if data.startswith(sig)), None)


class ImageCollector(HTMLParser):
    """Relève les <img> servies depuis /upload/ et le lien <a> qui les entoure."""

    def __init__(self) -> None:
        super().__init__()
        self.images: list[dict[str, str]] = []
        self._href: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self._href = a.get("href")
        elif tag == "img" and "/upload/" in (a.get("src") or ""):
            self.images.append({"src": a["src"], "alt": a.get("alt") or "", "href": self._href or ""})

    def handle_endtag(self, tag):
        if tag == "a":
            self._href = None


def page_url(name: str) -> str:
    # Le ":" doit rester tel quel : ce wiki renvoie 404 sur "Configuration%3A…".
    return f"{BASE}/wiki/" + urllib.parse.quote("Configuration:" + name.replace(" ", "_"), safe="/:")


def pick_image(images: list[dict[str, str]], name: str) -> dict[str, str] | None:
    candidates = [i for i in images if "config" in urllib.parse.unquote(i["src"]).lower()]
    exact = [i for i in candidates if name.lower() in i["alt"].lower()]
    return (exact or candidates or [None])[0]


def uploader_of(file_page_html: str) -> str | None:
    """Premier utilisateur de l'historique du fichier (version actuelle)."""
    start = file_page_html.find('id="filehistory"')
    section = file_page_html[start:] if start >= 0 else file_page_html
    m = re.search(r'class="mw-userlink[^"]*"[^>]*>(?:<bdi>)?([^<]+)<', section) or re.search(
        r'href="/wiki/(?:Utilisateur|User):[^"]+"[^>]*>([^<]+)<', section  # MediaWiki ancien (ce wiki)
    )
    return m.group(1).strip() if m else None


def file_attribution(img: dict[str, str], image_url: str) -> tuple[str | None, str | None]:
    """(page de description, contributeur). Facultatif : un échec ici ne fait pas perdre l'image."""
    if "/wiki/" in img["href"]:
        candidates = [urllib.parse.urljoin(BASE, img["href"])]
    else:  # la plupart des images ne sont pas cliquables : on déduit la page du nom de fichier
        filename = image_url.rsplit("/", 1)[-1]
        candidates = [f"{BASE}/wiki/Image:{filename}", f"{BASE}/wiki/Fichier:{filename}"]
    for url in candidates:
        time.sleep(DELAY_S)
        try:
            return url, uploader_of(fetch(url)[0].decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            continue
    return None, None


def download(args: argparse.Namespace) -> int:
    staging = Path(args.staging)
    if staging.exists() and any(staging.iterdir()):
        sys.exit(f"Le dossier de transit doit être vide : {staging}")
    staging.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))

    credits, missing = [], []
    for item in catalog["handshapes"]:
        hid, name = item["id"], item["name"]
        source_page = page_url(name)
        try:
            html, _ = fetch(source_page)
            collector = ImageCollector()
            collector.feed(html.decode("utf-8", "replace"))
            img = pick_image(collector.images, name)
            if not img:
                raise ValueError("aucune image de configuration sur la page")
            image_url = urllib.parse.urljoin(BASE, img["src"])
            if urllib.parse.urlparse(image_url).hostname != urllib.parse.urlparse(BASE).hostname:
                raise ValueError(f"image hors du site : {image_url}")
            time.sleep(DELAY_S)
            data, ctype = fetch(image_url, MAX_BYTES)
            ext = sniff(data)
            if not ext or not ctype.startswith("image/"):
                raise ValueError(f"contenu non reconnu comme image ({ctype})")
            (staging / f"{hid}.{ext}").write_bytes(data)

            file_page, uploader = file_attribution(img, image_url)
            credits.append(
                {
                    "id": hid,
                    "name": name,
                    "file": f"{hid}.{ext}",
                    "bytes": len(data),
                    "sourcePage": source_page,
                    "filePage": file_page,
                    "imageUrl": image_url,
                    "uploader": uploader,
                    "license": LICENSE,
                }
            )
            print(f"ok   {hid:28} {len(data):>7} o  {uploader or '?'}")
        except Exception as e:  # noqa: BLE001 — on continue avec les autres configurations
            missing.append({"id": hid, "name": name, "sourcePage": source_page, "error": str(e)})
            print(f"ÉCHEC {hid:27} {e}")
        time.sleep(DELAY_S)

    (staging / "credits.json").write_text(
        json.dumps({"credits": credits, "missing": missing}, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n{len(credits)} images, {len(missing)} échecs → {staging / 'credits.json'}")
    return 0 if credits else 1


def install(args: argparse.Namespace) -> int:
    staging, dest, catalog_path = Path(args.staging), Path(args.dest), Path(args.catalog)
    report = json.loads((staging / "credits.json").read_text(encoding="utf-8"))
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    by_id = {h["id"]: h for h in catalog["handshapes"]}
    public_root = Path(args.public_root).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    url_prefix = "/" + dest.resolve().relative_to(public_root).as_posix()

    installed = []
    for c in report["credits"]:
        hid, file = c["id"], c["file"]
        if not ID_PATTERN.match(hid) or hid not in by_id or file != f"{hid}.{file.rsplit('.', 1)[-1]}":
            print(f"ignoré (identifiant inattendu) : {hid}")
            continue
        src = staging / file
        data = src.read_bytes()
        ext = sniff(data)
        if not ext or len(data) > MAX_BYTES or not file.endswith("." + ext):
            print(f"ignoré (fichier invalide) : {file}")
            continue
        shutil.copyfile(src, dest / file)
        by_id[hid]["imageUrl"] = f"{url_prefix}/{file}"
        installed.append(c)

    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lines = [
        "# Crédits des illustrations de configurations",
        "",
        f"Images issues de [Wikisign LSF]({BASE}), sous licence [{LICENSE}]({LICENSE_URL}).",
        "Elles sont redistribuées sans modification, sous la même licence.",
        "",
        "| Configuration | Fichier | Contributeur | Source |",
        "| --- | --- | --- | --- |",
    ]
    for c in installed:
        lines.append(f"| {c['name']} | {c['file']} | {c['uploader'] or 'non indiqué'} | {c['filePage'] or c['sourcePage']} |")
    (dest / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(installed)} images installées dans {dest}, catalogue mis à jour.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    d = sub.add_parser("download")
    d.add_argument("--catalog", required=True)
    d.add_argument("--staging", required=True)
    i = sub.add_parser("install")
    i.add_argument("--catalog", required=True)
    i.add_argument("--staging", required=True)
    i.add_argument("--dest", required=True)
    i.add_argument("--public-root", default="public")
    args = parser.parse_args()
    return download(args) if args.command == "download" else install(args)


if __name__ == "__main__":
    sys.exit(main())
