"""Bounded matchday worker: public FPL scores -> GitHub live-data branch."""
import copy
import json
import os
import subprocess
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from update_fpl import fetch, squad_detail, team_view, write_json

ROOT = Path(__file__).resolve().parents[1]
LIVE = ROOT / '.live'


def interval(now):
    return 60 if now.astimezone(ZoneInfo('Asia/Kolkata')).weekday() in (5, 6) else 900


def match_window(fixtures, now):
    for f in fixtures:
        if f.get('finished') or not f.get('kickoff_time'):
            continue
        kickoff = datetime.fromisoformat(f['kickoff_time'].replace('Z', '+00:00'))
        # Stay awake shortly before kickoff; cap stale/unclosed fixtures at 4h.
        if kickoff - timedelta(minutes=30) <= now <= kickoff + timedelta(hours=4):
            return True
    return False


def score_team(team, points):
    result = copy.deepcopy(team)
    for p in result['players']:
        if p['id'] not in points:
            raise ValueError('Incomplete live player scores')
        p['points'] = points[p['id']]
        p['earned'] = p['points'] * p['multiplier']
    result['final'] = False
    h = result['entry_history']
    gross = sum(p['earned'] for p in result['players'])
    net = gross - h.get('event_transfers_cost', 0)
    previous = h['total_points'] - h['points'] + h.get('event_transfers_cost', 0)
    return result, gross, previous + net


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def prepare_branch():
    if not git('ls-remote', '--heads', 'origin', 'live-data'):
        git('push', 'origin', 'HEAD:refs/heads/live-data')
    git('fetch', 'origin', 'live-data')
    git('worktree', 'add', '--detach', str(LIVE), 'FETCH_HEAD')
    git('-C', str(LIVE), 'config', 'user.name', 'github-actions[bot]')
    git('-C', str(LIVE), 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')


def main():
    prepare_branch()
    until = time.monotonic() + 320 * 60
    last_details = 0
    squads, ranks = {}, {}
    failures = 0
    while time.monotonic() < until:
        tick = time.monotonic()
        now = datetime.now(timezone.utc)
        try:
            fixtures = fetch('fixtures/')
            if not match_window(fixtures, now):
                print('No live or imminent match. Worker finished.', flush=True)
                return
            if not squads or tick - last_details >= 900:
                bootstrap = fetch('bootstrap-static/')
                event = next(e for e in bootstrap['events'] if e['is_current'])
                elements = {p['id']: p for p in bootstrap['elements']}
                names = {i: p['web_name'] for i, p in elements.items()}
                teams = {t['id']: t['short_name'] for t in bootstrap['teams']}
                # Latest main snapshot supplies league membership; picks come from FPL.
                git('fetch', 'origin', 'main')
                base = json.loads(git('show', 'FETCH_HEAD:data/league.json'))
                for m in base['managers']:
                    picks = fetch(f"entry/{m['id']}/event/{event['id']}/picks/")
                    detail = squad_detail(picks, {}, names)
                    squad = team_view(detail, elements, teams, {}, event['id'], False)
                    squad['entry_history'] = picks['entry_history']
                    squads[m['id']] = squad
                    try:
                        entry = fetch(f"entry/{m['id']}/")
                        ranks[m['id']] = {'value': entry.get('summary_overall_rank'), 'updated_at': datetime.now(timezone.utc).isoformat()}
                    except Exception:
                        pass  # Retain the previous official rank, never invent it.
                last_details = tick
            live = fetch(f"event/{event['id']}/live/")
            points = {p['id']: p['stats']['total_points'] for p in live['elements']}
            managers = []
            for m in base['managers']:
                team, gross, total = score_team(squads[m['id']], points)
                managers.append({'id': m['id'], 'public_team': team, 'event_total': gross,
                                 'total': total, 'official_rank': ranks.get(m['id'])})
            current_fixtures = [{'id': f['id'], 'gw': f['event'], 'home': teams[f['team_h']], 'away': teams[f['team_a']],
                                 'home_score': f.get('team_h_score'), 'away_score': f.get('team_a_score'),
                                 'started': f.get('started', False), 'finished': f.get('finished', False),
                                 'kickoff': f.get('kickoff_time')} for f in fixtures if f.get('event') == event['id']]
            snapshot = {'league_id': base['league_id'], 'season': base['season'], 'gw': event['id'],
                        'deadline': event['deadline_time'], 'updated_at': datetime.now(timezone.utc).isoformat(),
                        'interval_seconds': interval(now), 'managers': managers, 'fixtures': current_fixtures}
            write_json(LIVE / 'data/live.json', snapshot)
            git('-C', str(LIVE), 'add', 'data/live.json')
            git('-C', str(LIVE), 'commit', '-m', 'Update matchday scores')
            git('-C', str(LIVE), 'push', 'origin', 'HEAD:refs/heads/live-data')
            failures = 0
            print('Published live scores: ' + snapshot['updated_at'], flush=True)
        except Exception as exc:
            failures += 1
            print(f'Live update failed; previous snapshot retained: {type(exc).__name__}: {exc}', flush=True)
            if failures >= 5:
                raise
        time.sleep(max(1, interval(now) - (time.monotonic() - tick)))


if __name__ == '__main__':
    main()
