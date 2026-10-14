"""LaunchBox Games DB -> compact box-art index: {platform: {normalised title: [image files]}}.

Same source and title keys as build-fanart-index.py, but "Box - Front" art (the game's case), for the
systems whose own files carry no proper cover (PS4 ships only a square icon). PC ports of console
games reuse their console's entry.

Usage: python scripts/build-box-index.py Metadata.xml resources/classic-box-index.json
"""
import json, re, sys, unicodedata
import xml.etree.ElementTree as ET


def norm(title):  # same keys as build-fanart-index.py / normaliseFanartTitle

    t = re.sub("[™®©]", "", title)
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", t)
    t = t.replace("&", " and ")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return " ".join(t.split())


PLATFORMS = {"Sony Playstation 4": "ps4", "Nintendo 64": "n64"}  # n64: Ship of Harkinian (port)
REGION_SCORE = {"North America": 3, "": 2, "World": 2, "United States": 3, "Brazil": 4}

games = {}  # DatabaseID -> (platform, [names])
boxes = {}  # DatabaseID -> [(score, file)]
for _, el in ET.iterparse(sys.argv[1], events=("end",)):
    if el.tag == "Game":
        platform = PLATFORMS.get(el.findtext("Platform") or "")
        if platform:
            games[el.findtext("DatabaseID")] = (platform, [el.findtext("Name") or ""])
        el.clear()
    elif el.tag == "GameAlternateName":
        gid = el.findtext("DatabaseID")
        if gid in games:
            games[gid][1].append(el.findtext("AlternateName") or "")
        el.clear()
    elif el.tag == "GameImage":
        if el.findtext("Type") == "Box - Front":
            region = el.findtext("Region") or ""
            boxes.setdefault(el.findtext("DatabaseID"), []).append(
                (REGION_SCORE.get(region, 1), el.findtext("FileName"))
            )
        el.clear()

index = {}
for gid, (platform, names) in games.items():
    if gid not in boxes:
        continue
    bucket = index.setdefault(platform, {})
    files = [f for _, f in sorted(boxes[gid], key=lambda x: -x[0])][:3]
    for name in names:
        key = norm(name)
        if key and key not in bucket:
            bucket[key] = files

json.dump(index, open(sys.argv[2], "w", encoding="utf8"), separators=(",", ":"))
print({p: len(v) for p, v in index.items()})
