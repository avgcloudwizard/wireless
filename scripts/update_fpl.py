#!/usr/bin/env python3
"""Public FPL -> one consistent JSON snapshot. Python standard library only."""
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
try:
    from .regrets import build_regrets
    from .season_model import forecast, calibrate_projections, award_months, prize_tracker
except ImportError:
    from regrets import build_regrets
    from season_model import forecast, calibrate_projections, award_months, prize_tracker

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://fantasy.premierleague.com/api/'

def fetch(path):
    for attempt in range(3):
        try:
            time.sleep(0.3)
            req = urllib.request.Request(BASE + path, headers={'User-Agent': 'FPL-Friends-Stats/1.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(temp, path)

def average(values):
    return round(sum(values) / len(values), 2) if values else None

def ranks(items, key, field='rank'):
    """Competition ranking; equal keys share a rank."""
    ordered = sorted(items, key=key)
    last, rank = None, 0
    for i, item in enumerate(ordered, 1):
        value = key(item)
        if value != last:
            rank = i
        item[field] = rank
        last = value
    return ordered

def normalize(value, values):
    if not values or value is None:
        return 50
    low, high = min(values), max(values)
    return 50 if low == high else (value - low) / (high - low) * 100

def captain_detail(picks, live, players):
    squad = picks.get('picks', [])
    # Final multipliers reflect vice-captain fallback, triple captain and autosubs.
    captain = next((p for p in squad if p.get('multiplier', 0) > 1), None)
    if captain is None:
        captain = next((p for p in squad if p.get('is_captain')), None)
    if not captain:
        return {}
    element = captain['element']
    points = live.get(element)
    multiplier = captain.get('multiplier', 0)
    return {'captain': players.get(element, str(element)),
            'captain_points': points * multiplier if points is not None else None,
            'captain_base_points': points, 'captain_id': element,
            'captain_multiplier': multiplier, 'chip': picks.get('active_chip')}

def squad_detail(picks, live, players):
    detail = captain_detail(picks, live, players)
    squad = picks.get('picks', [])
    detail['squad'] = [p['element'] for p in squad]
    detail['lineup'] = [{k: p.get(k) for k in ('element', 'position', 'multiplier', 'is_captain', 'is_vice_captain')} for p in squad]
    detail['automatic_subs'] = picks.get('automatic_subs', [])
    # Zero-multiplier bench players earned no points for this manager.
    active = [p for p in squad if p.get('multiplier', 0) > 0]
    if squad and all(p['element'] in live for p in active):
        detail['player_base_points'] = {str(p['element']): live[p['element']] for p in active}
        detail['player_points'] = {str(p['element']): live[p['element']] * p['multiplier'] for p in active}
    return detail

def free_transfers(history, chips, cap=5):
    """Allowance entering the next GW, before non-public pre-deadline moves."""
    rows = sorted(history, key=lambda r: r['event'])
    if not rows:
        return None
    if [r['event'] for r in rows] != list(range(rows[0]['event'], rows[-1]['event'] + 1)):
        return None
    bank = 1  # Unlimited setup transfers; one FT after the manager's first GW.
    for r in rows[1:]:
        if chips.get(r['event']) in ('wildcard', 'freehit'):
            continue  # Existing bank retained, with no extra FT for the chip GW.
        bank = min(cap, max(0, bank - r['event_transfers']) + 1)
    return bank

def player_info(p, teams):
    return {'id': p['id'], 'name': p['web_name'], 'team': teams.get(p['team'], ''),
            'photo': None if p.get('has_temporary_code') else
            f"https://resources.premierleague.com/premierleague25/photos/players/110x140/{p['code']}.png"}

def price_watch(bootstrap):
    teams = {t['id']: t['short_name'] for t in bootstrap['teams']}
    result = []
    labels = {5: 'Very likely to rise', 4: 'Likely to rise', -4: 'Likely to drop', -5: 'Very likely to drop'}
    for p in bootstrap['elements']:
        projection = next((x for x in p.get('price_change_projections', []) if x.get('offset') == 0), {})
        likelihood = projection.get('likelihood')
        predicted = projection.get('projected_percent')
        locked = p.get('price_change_locked_until')
        if locked:
            status, direction = 'Price locked', 0
        elif p.get('price_change_calibrating'):
            status, direction = 'Calibrating', 0
        elif likelihood is None or predicted is None:
            status, direction = 'Forecast unavailable', 0
        else:
            status = labels.get(likelihood, 'Unlikely to change')
            direction = 1 if likelihood in (4, 5) else -1 if likelihood in (-4, -5) else 0
        result.append({**player_info(p, teams), 'full_name': (p.get('first_name', '') + ' ' + p.get('second_name', '')).strip(), 'price': p['now_cost'] / 10,
                       'ownership': float(p['selected_by_percent']),
                       'gw_change': p['cost_change_event'] / 10,
                       'progress': float(p['price_change_percent']) if p.get('price_change_percent') is not None else None,
                       'projected_progress': float(predicted) if predicted is not None and not locked and not p.get('price_change_calibrating') else None,
                       'status': status, 'direction': direction, 'locked_until': locked})
    config = bootstrap.get('game_config', {})
    deadlines = config.get('settings', {}).get('price_change_deadlines', [])
    return {'players': result, 'deadline': deadlines[0] if deadlines else None,
            'source_updated_at': config.get('status', {}).get('price_change_last_updated')}

def manager_mvp(history, details, entry, elements, teams):
    totals, coverage = {}, 0
    for row in history:
        points = details.get(f"{entry}:{row['gw']}", {}).get('player_points')
        if points is None or sum(points.values()) != row['gross']:
            continue
        coverage += 1
        for player, value in points.items():
            totals[int(player)] = totals.get(int(player), 0) + value
    # A partial history cannot identify the true MVP; don't invent a winner.
    if not totals or coverage != len(history):
        return [], coverage
    highest = max(totals.values())
    return [{**player_info(elements[p], teams), 'points': points}
            for p, points in sorted(totals.items()) if points == highest and p in elements], coverage

def scoring_awards(history, details, entry):
    failures, hauls, coverage = [], 0, 0
    for row in history:
        detail = details.get(f"{entry}:{row['gw']}", {})
        if detail.get('captain_base_points') is not None and 'player_base_points' in detail and sum(detail.get('player_points', {}).values()) == row['gross']:
            coverage += 1
            if detail['captain_base_points'] <= 4:
                failures.append({'gw': row['gw'], 'player': detail['captain'], 'points': detail['captain_base_points']})
            hauls += sum(points >= 12 for points in detail['player_base_points'].values())
    complete = bool(history) and coverage == len(history)
    return {'captain_failures': len(failures) if complete else None,
            'captain_failure_details': failures if complete else [],
            'hauls': hauls if complete else None, 'awards_coverage': coverage}

def build_stats(managers, events, total_events, start_event=1, chip_definitions=None, latest_completed=None):
    completed_ids = [e['id'] for e in events]
    by_gw = []
    previous = {}
    tie_transfers = {m['id']: 0 for m in managers}
    for event in events:
        rows = []
        for m in managers:
            row = next((dict(r) for r in m['history'] if r['gw'] == event['id']), None)
            if row is None:
                continue
            if row.get('chip') not in ('wildcard', 'freehit'):
                tie_transfers[m['id']] += row['transfers']
            row.update(id=m['id'], name=m['name'], team=m['team'], tie_transfers=tie_transfers[m['id']])
            # League may start after GW1; reconstruct its own score from that deadline.
            row['league_total'] = sum(r['net'] for r in m['history'] if start_event <= r['gw'] <= event['id'])
            rows.append(row)
        ranks(rows, lambda r: (-r['league_total'], r['tie_transfers']), 'league_rank')
        ranks(rows, lambda r: -r['net'], 'gw_rank')
        for row in rows:
            row['movement'] = previous[row['id']] - row['league_rank'] if row['id'] in previous else None
        previous = {r['id']: r['league_rank'] for r in rows}
        by_gw.append({**event, 'rows': sorted(rows, key=lambda r: (r['gw_rank'], r['league_rank']))})
    last_id = completed_ids[-1] if completed_ids else None
    for m in managers:
        hist = m['history']
        scores = [r['net'] for r in hist]
        recent = scores[-5:]
        positions = [r for gw in by_gw for r in gw['rows'] if r['id'] == m['id']]
        caps = [r['captain_points'] for r in hist if r.get('captain_points') is not None]
        last = next((r for r in hist if r['gw'] == last_id), None)
        season_avg, recent_avg = average(scores), average(recent)
        # Official current total may include an unfinished GW. Do not project it twice.
        completed_total = hist[-1]['total'] if hist else 0
        projection = forecast(m, total_events, latest_completed if latest_completed is not None else (last_id or 0), chip_definitions or [])
        gw_ranks = [r['overall_gw_rank'] for r in hist if r.get('overall_gw_rank')]
        best_gw_rank = min(gw_ranks, default=None)
        worst_gw_rank = max(gw_ranks, default=None)
        momentum = positions[-min(5, len(positions))]['league_rank'] - positions[-1]['league_rank'] if positions else 0
        m.update(average=season_avg, recent_average=recent_avg, recent=hist[-5:],
                 best=max(scores) if scores else None, worst=min(scores) if scores else None,
                 best_gws=[r['gw'] for r in hist if r['net'] == max(scores)] if scores else [],
                 worst_gws=[r['gw'] for r in hist if r['net'] == min(scores)] if scores else [],
                 bench=sum(r['bench'] for r in hist), captain_points=sum(caps) if caps else None,
                 captain_coverage=len(caps), completed_count=len(hist),
                 hits=sum(r['hits'] for r in hist), transfers=sum(r['transfers'] for r in hist),
                 highest_position=min((r['league_rank'] for r in positions), default=None),
                 wins=sum(r['gw_rank'] == 1 for r in positions),
                 biggest_rise=max([r['movement'] or 0 for r in positions] + [0]),
                 latest_score=last['net'] if last else None, momentum=momentum,
                 completed_total=completed_total, **projection,
                 worst_gw_rank=worst_gw_rank, worst_gw_rank_gws=[r['gw'] for r in hist if worst_gw_rank and r.get('overall_gw_rank') == worst_gw_rank],
                 best_gw_rank=best_gw_rank, best_gw_rank_gws=[r['gw'] for r in hist if best_gw_rank and r.get('overall_gw_rank') == best_gw_rank])
    eligible = [m for m in managers if m['average'] is not None]
    for m in managers:
        if m not in eligible:
            m.update(power=None, form='Not enough data', projected_position=None)
            continue
        components = [(0.4, 'latest_score'), (0.3, 'recent_average'), (0.2, 'average'), (0.1, 'momentum')]
        power = sum(weight * normalize(m[key], [x[key] for x in eligible if x[key] is not None]) for weight, key in components)
        m['power'] = round(power)
        form = normalize(m['recent_average'], [x['recent_average'] for x in eligible])
        m['form'] = 'Excellent' if form >= 75 else 'Good' if form >= 50 else 'Steady' if form >= 25 else 'Cold streak'
    calibrate_projections(eligible, total_events - (latest_completed if latest_completed is not None else (last_id or 0)))
    ranks(eligible, lambda m: -m['projected_total'], 'projected_position')
    monthly = []
    for month in sorted(set(e['month'] for e in events)):
        weeks = [gw for gw in by_gw if gw['month'] == month]
        before = next((gw for gw in reversed(by_gw) if gw['id'] < weeks[0]['id']), None)
        start_ranks = {r['id']: r['league_rank'] for r in before['rows']} if before else {}
        end_ranks = {r['id']: r['league_rank'] for r in weeks[-1]['rows']}
        rows = []
        for m in managers:
            month_rows = [r for gw in weeks for r in gw['rows'] if r['id'] == m['id']]
            scores = [r['net'] for r in month_rows]
            if scores:
                rows.append({'id': m['id'], 'name': m['name'], 'team': m['team'], 'points': sum(scores),
                             'average': average(scores), 'best': max(scores), 'worst': min(scores),
                             'best_gws': [r['gw'] for r in month_rows if r['net'] == max(scores)],
                             'worst_gws': [r['gw'] for r in month_rows if r['net'] == min(scores)],
                             'movement': start_ranks[m['id']] - end_ranks[m['id']] if m['id'] in start_ranks and m['id'] in end_ranks else None})
        monthly.append({'id': month, 'label': datetime.strptime(month, '%Y-%m').strftime('%B %Y'),
                        'gameweeks': [gw['id'] for gw in weeks], 'rows': ranks(rows, lambda r: -r['points'])})
    return by_gw, monthly

def comparison_history(current, chips):
    public_gw = max((r['event'] for r in current), default=0)
    before = max((r for r in current if r['event'] < public_gw), key=lambda r: r['event'], default=None)
    return {'tie_transfers': sum(r['event_transfers'] for r in current if chips.get(r['event']) not in ('wildcard', 'freehit')),
            'previous_total': before['total_points'] if before else None,
            'previous_overall_rank': before.get('overall_rank') if before else None,
            'previous_transfers': sum(r['event_transfers'] for r in current if r['event'] < public_gw and chips.get(r['event']) not in ('wildcard', 'freehit'))}

def creator_team(entry, gw, latest, elements, teams, live_cache, cache):
    """Only the latest public squad; checked squads are cached for one week."""
    if not gw:
        return None
    saved = cache.get(str(entry), {})
    previous = saved.get('team')
    final = gw <= latest
    if previous and previous['gw'] == gw and previous['final'] == final and final and time.time() - saved.get('fetched_at', 0) < 7 * 86400:
        return previous
    try:
        if gw not in live_cache:
            response = fetch(f'event/{gw}/live/')
            live_cache[gw] = {p['id']: p['stats']['total_points'] for p in response['elements']}
        picks = fetch(f'entry/{entry}/event/{gw}/picks/')
        detail = squad_detail(picks, live_cache[gw], {key: p['web_name'] for key, p in elements.items()})
        team = team_view(detail, elements, teams, live_cache[gw], gw, final)
        if not team or len(team['players']) != 15:
            raise ValueError('Incomplete public squad')
        team['updated_at'] = datetime.now(timezone.utc).isoformat()
        cache[str(entry)] = {'team': team, 'fetched_at': time.time()}
        return team
    except Exception as exc:
        print(f'Creator squad unavailable for {entry}: {type(exc).__name__}; keeping previous squad if available.', file=sys.stderr)
        return {**previous, 'stale': True} if previous else None

def update_creators(season, latest, cap, total_events, elements=None, teams=None, live_cache=None, team_cache=None):
    live_cache = live_cache if live_cache is not None else {}
    team_cache = team_cache if team_cache is not None else {}
    roster = json.loads((ROOT / 'content-creators.json').read_text())
    if str(roster['season']) != season:
        raise ValueError('Creator team IDs need checking for the new season')
    managers = []
    for creator in roster['managers']:
        entry = creator['id']
        print(f"Updating creator {creator['name']} ({entry})", flush=True)
        profile = fetch(f'entry/{entry}/')
        history = fetch(f'entry/{entry}/history/')
        current = sorted(history['current'], key=lambda r: r['event'])
        chips = {c['event']: c['name'] for c in history.get('chips', [])}
        latest_row = next((r for r in current if r['event'] == latest), None)
        public_gw = max((r['event'] for r in current), default=0)
        public_team = creator_team(entry, public_gw, latest, elements, teams, live_cache, team_cache) if elements else None
        managers.append({'public_team': public_team, 'id': entry, 'creator': True, 'name': creator['name'], 'team': profile['name'],
                         'total': profile['summary_overall_points'], 'live_rank': profile['summary_overall_rank'],
                         'latest_score': latest_row['points'] - latest_row['event_transfers_cost'] if latest_row else None,
                         'ft': free_transfers(current, chips, cap), 'ft_cap': cap,
                         'ft_gw': public_gw + 1 if public_gw < total_events else None,
                         'chips': [{'gw': gw, 'name': name} for gw, name in sorted(chips.items())],
                         **comparison_history(current, chips)})
    ranks(managers, lambda m: (-m['total'], m['tie_transfers']))
    previous = [m for m in managers if m['previous_total'] is not None]
    ranks(previous, lambda m: (-m['previous_total'], m['previous_transfers']), 'previous_rank')
    for m in managers:
        m['movement'] = m['previous_rank'] - m['rank'] if 'previous_rank' in m else None
    return {'updated_at': datetime.now(timezone.utc).isoformat(), 'roster_checked_at': roster['checked_at'], 'latest_completed': latest,
            'source': roster['source'], 'managers': sorted(managers, key=lambda m: m['rank'])}

def team_view(detail, elements, teams, live, gw, final):
    picks = [dict(p) for p in detail.get('lineup', [])]
    if not picks:
        return None
    by_id = {p['element']: p for p in picks}
    for sub in detail.get('automatic_subs', []):
        incoming, outgoing = by_id.get(sub['element_in']), by_id.get(sub['element_out'])
        if incoming and outgoing and incoming['position'] > 11 and outgoing['position'] <= 11:
            incoming['position'], outgoing['position'] = outgoing['position'], incoming['position']
    return {'gw': gw, 'final': final, 'chip': detail.get('chip'), 'players': [
        {**player_info(elements[p['element']], teams), 'role': elements[p['element']]['element_type'],
         'slot': p['position'], 'multiplier': p['multiplier'], 'captain': p['multiplier'] > 1,
         'vice': p.get('is_vice_captain', False), 'points': live.get(p['element']),
         'earned': live[p['element']] * p['multiplier'] if p['element'] in live else None}
        for p in sorted(picks, key=lambda p: p['position']) if p['element'] in elements]}

def main():
    config = json.loads((ROOT / 'config.json').read_text())
    league_id = int(config['league_id'])
    bootstrap = fetch('bootstrap-static/')
    players = {p['id']: p['web_name'] for p in bootstrap['elements']}
    elements = {p['id']: p for p in bootstrap['elements']}
    teams = {t['id']: t['short_name'] for t in bootstrap['teams']}
    ft_cap = 1 + bootstrap.get('game_settings', {}).get('max_extra_free_transfers', 4)
    season = bootstrap['events'][0]['deadline_time'][:4]
    standings, league, page = [], None, 1
    while True:
        response = fetch(f'leagues-classic/{league_id}/standings/?page_standings={page}')
        league = response['league']
        standings.extend(response['standings']['results'])
        if not response['standings']['has_next']:
            break
        page += 1
    start = league.get('start_event', 1)
    completed = [e for e in bootstrap['events'] if e['finished'] and e['data_checked']]
    events = [{'id': e['id'], 'deadline': e['deadline_time'],
               'month': datetime.fromisoformat(e['deadline_time'].replace('Z', '+00:00')).astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m')}
              for e in completed if e['id'] >= start]
    completed_ids = {e['id'] for e in completed}
    cache_path = ROOT / '.fpl-cache.json'
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    if cache.get('season') != season or cache.get('league_id') != league_id:
        cache = {'season': season, 'league_id': league_id, 'details': {}}
    details = cache['details']
    live_cache, warnings, managers = {}, [], []
    latest = max(completed_ids, default=0)
    active = next((e for e in bootstrap['events'] if e['is_current']), None)
    for s in standings:
        entry = s['entry']
        print(f"Updating {s['entry_name']} ({entry})", flush=True)
        # History is required: fail the snapshot if it is unavailable, preserving old data.
        history = fetch(f'entry/{entry}/history/')
        chips = {c['event']: c['name'] for c in history.get('chips', [])}
        try:
            entry_data = fetch(f'entry/{entry}/')
        except Exception:
            entry_data = {}
            warnings.append(f'Current overall rank unavailable for {s["entry_name"]}.')
        rows = []
        for h in history['current']:
            gw = h['event']
            if gw not in completed_ids:
                continue
            key = f'{entry}:{gw}'
            detail = details.get(key, {})
            if len(detail.get('lineup', [])) != 15 or 'player_base_points' not in detail or 'captain_base_points' not in detail or 'player_points' not in detail or 'squad' not in detail or gw == latest or time.time() - detail.get('fetched_at', 0) > 7 * 86400:
                try:
                    if gw not in live_cache:
                        live_data = fetch(f'event/{gw}/live/')
                        live_cache[gw] = {p['id']: p['stats']['total_points'] for p in live_data['elements']}
                    picks = fetch(f'entry/{entry}/event/{gw}/picks/')
                    detail = squad_detail(picks, live_cache[gw], players)
                    detail['fetched_at'] = time.time()
                    details[key] = detail
                except Exception as exc:
                    warnings.append(f'Player details unavailable for {s["entry_name"]}, GW{gw}; previous details retained if available.')
                    print(f'Optional detail failed: {type(exc).__name__}', file=sys.stderr)
            rows.append({'gw': gw, 'gross': h['points'], 'net': h['points'] - h['event_transfers_cost'],
                         'hits': h['event_transfers_cost'], 'transfers': h['event_transfers'],
                         'overall_rank': h.get('overall_rank'), 'overall_gw_rank': h.get('rank'), 'total': h['total_points'], 'bench': h['points_on_bench'],
                         'chip': chips.get(gw), **{k: v for k, v in detail.items() if k.startswith('captain')}})
        rows.sort(key=lambda r: r['gw'])
        latest_history = history['current'][-1] if history['current'] else {}
        public_gw = max((r['event'] for r in history['current']), default=0)
        # Free Hit squads are temporary. Track the restored permanent squad.
        squad_gw = public_gw - 1 if chips.get(public_gw) == 'freehit' else public_gw
        squad = details.get(f'{entry}:{squad_gw}', {}).get('squad', [])
        if squad_gw and (squad_gw not in completed_ids or not squad):
            try:
                picks = fetch(f'entry/{entry}/event/{squad_gw}/picks/')
                squad = [p['element'] for p in picks['picks']]
            except Exception:
                warnings.append(f'Public squad unavailable for {s["entry_name"]}.')
        public_team = None
        team_gw = max(public_gw, active['id'] if active else 0)
        if team_gw:
            team_detail = details.get(f'{entry}:{team_gw}', {})
            try:
                if team_gw not in completed_ids or not team_detail.get('lineup'):
                    picks = fetch(f'entry/{entry}/event/{team_gw}/picks/')
                    if team_gw not in live_cache:
                        live_data = fetch(f'event/{team_gw}/live/')
                        live_cache[team_gw] = {p['id']: p['stats']['total_points'] for p in live_data['elements']}
                    team_detail = squad_detail(picks, live_cache[team_gw], players)
                public_team = team_view(team_detail, elements, teams, live_cache.get(team_gw, {}), team_gw, team_gw in completed_ids)
                if public_team:
                    public_team['entry_history'] = picks.get('entry_history', {}) if team_gw not in completed_ids else latest_history
            except Exception:
                warnings.append(f'Public team details unavailable for {s["entry_name"]}.')
        mvp, mvp_coverage = manager_mvp(rows, details, entry, elements, teams)
        managers.append({'id': entry, 'name': s['player_name'], 'team': s['entry_name'],
                         'rank': s['rank'], 'total': s['total'], 'event_total': s['event_total'],
                         'movement': s['last_rank'] - s['rank'] if s.get('last_rank') else None,
                         'live_rank': entry_data.get('summary_overall_rank'),
                         'live_league_rank': s['rank'],
                         'ft': free_transfers(history['current'], chips, ft_cap), 'ft_cap': ft_cap,
                         'ft_gw': public_gw + 1 if public_gw < len(bootstrap['events']) else None,
                         'chips': [{'gw': gw, 'name': name} for gw, name in sorted(chips.items()) if gw <= public_gw],
                         'transfers_made': sum(h['event_transfers'] for h in history['current']),
                         'squad': squad, 'squad_gw': squad_gw or None,
                         'squad_restored': chips.get(public_gw) == 'freehit',
                         'mvp': mvp, 'mvp_coverage': mvp_coverage,
                         'public_team': public_team,
                         **scoring_awards(rows, details, entry),
                         **comparison_history(history['current'], chips),
                         # FPL history value includes the bank; expose squad-only value here.
                         'value': (latest_history['value'] - latest_history['bank']) / 10 if latest_history.get('value') is not None and latest_history.get('bank') is not None else None,
                         'bank': latest_history['bank'] / 10 if latest_history.get('bank') is not None else None,
                         'history': rows})
    try:
        regrets = build_regrets(managers, details, elements, completed_ids, cache, fetch)
        regrets['updated_at'] = datetime.now(timezone.utc).isoformat()
        cache['regrets'] = regrets
    except Exception as exc:
        print(f'Regret stats delayed: {type(exc).__name__}: {exc}', file=sys.stderr)
        regrets = {**cache.get('regrets', {}), 'stale': True}
        warnings.append('Regret statistics could not be refreshed; previous results retained where available.')
    gameweeks, monthly = build_stats(managers, events, len(bootstrap['events']), start, bootstrap.get('chips', []), latest)
    award_months(monthly, bootstrap['events'])
    prizes = prize_tracker(managers, monthly, bootstrap['events'], config['prizes'])
    for m in managers:
        previous_rank = m.get('previous_overall_rank')
        m['overall_movement_percent'] = (previous_rank - m['live_rank']) / previous_rank * 100 if previous_rank and m.get('live_rank') else None
        m['overall_movement_gw'] = max((r['gw'] for r in m['history']), default=0)
        if m.get('ft_gw'):
            m['overall_movement_gw'] = m['ft_gw'] - 1
    try:
        fixtures = fetch('fixtures/')
        fixture_kickoffs = [f['kickoff_time'] for f in fixtures if f.get('kickoff_time')]
        live_fixtures = [{'id': f['id'], 'gw': f.get('event'), 'home': teams.get(f['team_h'], '?'),
                          'away': teams.get(f['team_a'], '?'), 'home_score': f.get('team_h_score'),
                          'away_score': f.get('team_a_score'), 'started': f.get('started', False),
                          'finished': f.get('finished', False), 'kickoff': f.get('kickoff_time')}
                         for f in fixtures if active and f.get('event') == active['id']]
        fixtures_stale = False
    except Exception:
        prior_path = ROOT / 'data/league.json'
        prior = json.loads(prior_path.read_text()) if prior_path.exists() else {}
        fixture_kickoffs = prior.get('fixture_kickoffs', [])
        live_fixtures = prior.get('live_fixtures', [])
        fixtures_stale = True
        warnings.append('Fixture refresh failed; previous matchday schedule retained.')
    creators = None
    try:
        creators = update_creators(season, latest, ft_cap, len(bootstrap['events']), elements, teams, live_cache, cache.setdefault('creator_teams', {}))
    except Exception as exc:
        previous_path = ROOT / 'data/league.json'
        previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
        if previous.get('season', '').startswith(season + '/'):
            creators = previous.get('creators')
        warnings.append('Content Creator refresh failed; previous complete creator snapshot retained if available.')
        print(f'Creator update failed: {type(exc).__name__}: {exc}', file=sys.stderr)
    active = next((e for e in bootstrap['events'] if e['is_current']), None)
    data = {'version': 1, 'league_id': league_id, 'name': league['name'],
            'season': f'{season}/{str(int(season)+1)[-2:]}',
            'updated_at': datetime.now(timezone.utc).isoformat(), 'refresh_hours': config['refresh_hours'],
            'latest_completed': latest or None, 'completed_count': len(completed),
            'total_gameweeks': len(bootstrap['events']),
            'current_gw': active['id'] if active else None,
            'current_deadline': active['deadline_time'] if active else None,
            'in_progress': bool(active and active['id'] not in completed_ids),
            'regrets': regrets, 'prices': price_watch(bootstrap), 'refresh_minutes_matchday': config.get('matchday_minutes', 15),
            'live_fixtures': live_fixtures, 'fixtures_stale': fixtures_stale,
            'fixture_kickoffs': fixture_kickoffs, 'prizes': prizes, 'creators': creators,
            'warnings': warnings, 'managers': managers, 'gameweeks': gameweeks, 'months': monthly}
    write_json(ROOT / 'data/league.json', data)
    write_json(cache_path, cache)
    print(f"Saved {len(managers)} managers and {len(gameweeks)} completed gameweeks.")

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Update failed; previous successful dataset kept. {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
