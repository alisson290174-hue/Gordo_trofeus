"""LaunchBox Games DB -> compact fanart index: {platform: {normalised title: [image files]}}.

Only console platforms Opus emulates, only "Fanart - Background" art (the wide, full-screen
pictures). Alternate names are indexed too, so "Pokemon - Black Version" and "Pokémon Black"
both find the game.
"""
import json, re, sys, unicodedata
import xml.etree.ElementTree as ET

PLATFORMS = {
    "Nintendo Switch": "switch",
    "Nintendo 64": "n64",
    "Super Nintendo Entertainment System": "snes",
    "Nintendo Entertainment System": "nes",
    "Nintendo Game Boy Advance": "gba",
    "Nintendo Game Boy Color": "gbc",
    "Nintendo Game Boy": "gb",
    "Nintendo DS": "ds",
    "Nintendo 3DS": "3ds",
    "Nintendo GameCube": "gc",
    "Nintendo Wii": "wii",
    "Sony Playstation": "ps1",
    "Sony Playstation 2": "ps2",
    "Sony Playstation 3": "ps3",
    "Sony Playstation 4": "ps4",
    "Sony PSP": "psp",
    "Microsoft Xbox": "xbox",
    "Microsoft Xbox 360": "xbox360",
    "Sega Genesis": "genesis",
    "Windows": "pc",
}


def norm(title):
    # Before NFKD, which would turn "™" into the letters "TM".
    t = re.sub("[™®©]", "", title)
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", t)
    t = t.replace("&", " and ")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return " ".join(t.split())


games = {}      # DatabaseID -> (platformKey, [names])
fanart = {}     # DatabaseID -> [(score, file)]

for event, el in ET.iterparse(sys.argv[1], events=("end",)):
    tag = el.tag
    if tag == "Game":
        platform = PLATFORMS.get(el.findtext("Platform") or "")
        if platform:
            games[el.findtext("DatabaseID")] = (platform, [el.findtext("Name") or ""])
        el.clear()
    elif tag == "GameAlternateName":
        gid = el.findtext("DatabaseID")
        if gid in games:
            games[gid][1].append(el.findtext("AlternateName") or "")
        el.clear()
    elif tag == "GameImage":
        if el.findtext("Type") == "Fanart - Background":
            gid = el.findtext("DatabaseID")
            region = el.findtext("Region") or ""
            # Prefer region-less / North America art, then any.
            score = 2 if region in ("", "North America", "World") else 1
            fanart.setdefault(gid, []).append((score, el.findtext("FileName")))
        el.clear()

index = {}
for gid, (platform, names) in games.items():
    if gid not in fanart:
        continue
    bucket = index.setdefault(platform, {})
    # Every background the game has (best region first, at most 6): Opus measures them and
    # keeps the first wide, sharp one.
    files = [f for _, f in sorted(fanart[gid], key=lambda x: -x[0])][:6]
    for name in names:
        key = norm(name)
        if key and key not in bucket:
            bucket[key] = files

json.dump(index, open(sys.argv[2], "w", encoding="utf8"), separators=(",", ":"))
print({p: len(v) for p, v in index.items()})
