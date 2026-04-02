import os
import json
import re
from datetime import datetime, timezone
from collections import defaultdict
import urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
REPO  = os.environ["REPO"]

SKIP_RE = re.compile(r"\[skip ci\]|chore: update changelog", re.I)

CONV_RE = re.compile(
    r"^(feat|fix|style|docs|chore|refactor|perf|test|ci|build)(\([^)]*\))?!?:\s*(.+)",
    re.I,
)

BADGE = {
    "feat":     ("badge-feat",  "feat"),
    "fix":      ("badge-fix",   "fix"),
    "style":    ("badge-style", "style"),
    "docs":     ("badge-docs",  "docs"),
    "chore":    ("badge-chore", "chore"),
    "refactor": ("badge-feat",  "refactor"),
    "perf":     ("badge-feat",  "perf"),
    "test":     ("badge-chore", "test"),
    "ci":       ("badge-chore", "ci"),
    "build":    ("badge-chore", "build"),
}


def gh_get(path):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def fetch_all_commits():
    commits = []
    page = 1
    while True:
        chunk = gh_get(f"commits?per_page=100&page={page}")
        if not chunk:
            break
        commits.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
    return commits


def parse_commit(c):
    sha   = c["sha"]
    msg   = c["commit"]["message"].split("\n")[0].strip()
    dt_str = c["commit"]["committer"]["date"]
    dt    = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))

    if SKIP_RE.search(msg):
        return None

    m = CONV_RE.match(msg)
    if m:
        kind  = m.group(1).lower()
        title = m.group(3).strip()
    else:
        kind  = "chore"
        title = msg

    badge_cls, badge_label = BADGE.get(kind, ("badge-chore", kind))
    return dict(sha=sha, title=title, badge_cls=badge_cls,
                badge_label=badge_label, dt=dt)


MONTHS_ES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def fmt_day(dt):
    return f"{dt.day} de {MONTHS_ES[dt.month]} de {dt.year}"


def build_timeline_html(commits_parsed):
    groups = defaultdict(list)
    for c in commits_parsed:
        day_key = c["dt"].astimezone(timezone.utc).date()
        groups[day_key].append(c)

    html = []
    for day in sorted(groups.keys(), reverse=True):
        html.append(f'    <div class="day-group">')
        html.append(f'      <div class="day-label">{fmt_day(datetime(day.year, day.month, day.day))}</div>')
        for c in groups[day]:
            sha7 = c["sha"][:7]
            url  = f"https://github.com/{REPO}/commit/{c['sha']}"
            time_str = c["dt"].astimezone(timezone.utc).strftime("%H:%M")
            title_esc = c["title"].replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            html.append(f"""
      <div class="entry">
        <div class="entry-badge"><span class="badge {c['badge_cls']}">{c['badge_label']}</span></div>
        <div class="entry-body">
          <div class="entry-title">{title_esc}</div>
          <div class="entry-meta">
            <a class="entry-sha" href="{url}" target="_blank">{sha7}</a>
            <span class="entry-time">{time_str}</span>
          </div>
        </div>
      </div>""")
        html.append('    </div>')
    return "\n".join(html)


TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Changelog &middot; Ma&ntilde;a Maps</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{{box-sizing:border-box;margin:0;padding:0;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;}}
:root{{
  --bg:#ffffff;--bgBox:#f4f8fb;--primary:#30363b;--secondary:#555;
  --third:#828c99;--blue:#0ea5e9;--border:rgba(30,30,30,0.1);
  --shadow:rgb(15 15 15/8%) 0 1px 3px,rgb(15 15 15/5%) 0 4px 12px;
  --green:#10b981;--red:#ef4444;--amber:#f59e0b;--purple:#8b5cf6;
}}
html,body{{height:100%;background:var(--bg);color:var(--primary);}}
#topbar{{
  height:56px;border-bottom:1px solid var(--border);background:var(--bg);
  display:flex;align-items:center;padding:0 20px;gap:12px;
  position:sticky;top:0;z-index:100;
}}
.mana-logo-wrap{{display:flex;align-items:center;gap:10px;cursor:pointer;text-decoration:none;}}
.mana-logo-icon{{position:relative;width:36px;height:36px;flex-shrink:0;}}
.mana-logo-icon svg{{width:100%;height:100%;}}
.mana-logo-icon span{{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-family:Tahoma,Verdana,sans-serif;font-weight:900;font-size:15px;color:white;
  line-height:1;pointer-events:none;
}}
.logo-wordmark{{font-size:17px;font-weight:900;letter-spacing:-0.5px;color:var(--primary);}}
.logo-sub{{font-size:10px;color:var(--third);font-weight:600;vertical-align:super;margin-left:1px;letter-spacing:.02em;}}
.topbar-right{{margin-left:auto;display:flex;align-items:center;gap:8px;}}
.btn{{
  display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:50px;
  font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s,transform .1s;
  white-space:nowrap;text-decoration:none;
}}
.btn-ghost{{background:none;border:1px solid var(--border);color:var(--primary);}}
.btn-ghost:hover{{background:var(--bgBox);}}
.page{{max-width:680px;margin:0 auto;padding:48px 24px 80px;}}
.page-header{{margin-bottom:48px;}}
.page-header h1{{font-size:28px;font-weight:900;letter-spacing:-.5px;color:var(--primary);margin-bottom:8px;}}
.page-header p{{font-size:15px;color:var(--third);line-height:1.6;}}
.timeline{{display:flex;flex-direction:column;gap:0;}}
.day-group{{margin-bottom:40px;}}
.day-label{{
  font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
  color:var(--third);margin-bottom:16px;padding-bottom:8px;
  border-bottom:1px solid var(--border);
}}
.entry{{display:flex;gap:16px;padding:14px 0;border-bottom:1px solid var(--border);}}
.entry:last-child{{border-bottom:none;}}
.entry-badge{{flex-shrink:0;margin-top:2px;width:56px;text-align:center;}}
.badge{{
  display:inline-block;padding:3px 8px;border-radius:50px;
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  white-space:nowrap;
}}
.badge-feat{{background:#dbeafe;color:#1d4ed8;}}
.badge-fix{{background:#dcfce7;color:#15803d;}}
.badge-style{{background:#faf5ff;color:#7c3aed;}}
.badge-docs{{background:#fef9c3;color:#92400e;}}
.badge-chore{{background:#f1f5f9;color:#475569;}}
.entry-body{{flex:1;min-width:0;}}
.entry-title{{font-size:14px;font-weight:600;color:var(--primary);margin-bottom:4px;line-height:1.4;}}
.entry-meta{{display:flex;align-items:center;gap:10px;margin-top:6px;}}
.entry-sha{{
  font-family:'DM Mono',monospace;font-size:10px;color:var(--third);
  text-decoration:none;transition:color .12s;
}}
.entry-sha:hover{{color:var(--blue);}}
.entry-time{{font-size:11px;color:var(--third);}}
.page-footer{{margin-top:64px;padding-top:24px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--third);}}
.page-footer a{{color:var(--third);text-decoration:none;}}
.page-footer a:hover{{color:var(--primary);}}
</style>
</head>
<body>
<div id="topbar">
  <a class="mana-logo-wrap" href="/">
    <div class="mana-logo-icon">
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <path fill="#30363B" stroke="rgba(1,1,1,0.5)" stroke-width="1"
          d="M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z"
          transform="translate(100 100)"/>
      </svg>
      <span>M&#771;</span>
    </div>
    <span class="logo-wordmark">Ma&ntilde;a</span><span class="logo-sub">Maps</span>
  </a>
  <div class="topbar-right">
    <a class="btn btn-ghost" href="/">Volver al mapa</a>
  </div>
</div>
<div class="page">
  <div class="page-header">
    <h1>Changelog</h1>
    <p>Historial de cambios y mejoras de Ma&ntilde;a Maps. Todos los commits, organizados por fecha.</p>
  </div>
  <div class="timeline">
{timeline}
  </div>
  <div class="page-footer">
    Ma&ntilde;a Maps &mdash; <a href="https://github.com/{repo}" target="_blank">GitHub</a>
  </div>
</div>
</body>
</html>
"""


def main():
    raw = fetch_all_commits()
    parsed = [p for c in raw if (p := parse_commit(c)) is not None]
    timeline = build_timeline_html(parsed)
    html = TEMPLATE.format(timeline=timeline, repo=REPO)
    out = os.path.join(os.path.dirname(__file__), "..", "..", "changelog", "index.html")
    with open(os.path.normpath(out), "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Changelog generado con {len(parsed)} entradas.")


if __name__ == "__main__":
    main()
