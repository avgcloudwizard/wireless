"""Public-data counterfactuals; no predictions or private team access."""
from itertools import combinations
import time
from copy import deepcopy


def original_lineup(detail):
    picks = [dict(p) for p in detail['lineup']]
    by_id = {p['element']: p for p in picks}
    # Final picks can have autosub positions swapped. Restore the submitted order.
    for sub in reversed(detail.get('automatic_subs', [])):
        out, incoming = by_id[sub['element_out']], by_id[sub['element_in']]
        out['position'], incoming['position'] = incoming['position'], out['position']
    return sorted(picks, key=lambda p: p['position'])


def untouched_score(lineup, stats, roles, pending=None):
    """Use original bench priority, legal formations and GW1 captain/vice."""
    if len(lineup) != 15 or any(p['element'] not in stats for p in lineup):
        raise ValueError('Incomplete frozen squad or player scores')
    pending = set(pending or ())
    played = lambda pid: stats[pid]['minutes'] > 0 or stats[pid].get('red_cards', 0) > 0 or stats[pid].get('yellow_cards', 0) > 0
    starters = [p['element'] for p in lineup[:11]]
    bench = [p['element'] for p in lineup[11:]]
    gk = next(p for p in starters if roles[p] == 1)
    reserve = next(p for p in bench if roles[p] == 1)
    selected = starters[:]
    if not played(gk) and gk not in pending and played(reserve):
        selected[selected.index(gk)] = reserve
    absent = [p for p in starters if roles[p] != 1 and not played(p) and p not in pending]
    available = [p for p in bench if roles[p] != 1 and played(p)]
    # Maximise legal subs, then prioritise the earliest bench players.
    found = False
    for n in range(min(len(absent), len(available)), -1, -1):
        for incoming in combinations(available, n):
            for outgoing in combinations(absent, n):
                candidate = [p for p in selected if p not in outgoing] + list(incoming)
                counts = {r: sum(roles[p] == r for p in candidate) for r in (1, 2, 3, 4)}
                if counts[1] == 1 and 3 <= counts[2] <= 5 and 2 <= counts[3] <= 5 and 1 <= counts[4] <= 3:
                    selected, found = candidate, True
                    break
            if found:
                break
        if found:
            break
    captain = next(p['element'] for p in lineup if p['is_captain'])
    vice = next(p['element'] for p in lineup if p['is_vice_captain'])
    captain = captain if played(captain) or captain in pending else vice if played(vice) else None
    points = sum(stats[p]['total_points'] for p in selected)
    if captain in selected:
        points += stats[captain]['total_points']
    return points


def perma_captains(history, details, live, elements):
    choices = [('Haaland', 'Haaland'), ('B.Fernandes', 'Bruno Fernandes'),
               ('Palmer', 'Palmer'), ('Saka', 'Saka'), ('João Pedro', 'João Pedro')]
    rows = []
    for web_name, label in choices:
        player = next((pid for pid, e in elements.items() if e['web_name'] == web_name
                       and (web_name != 'Palmer' or e.get('first_name') == 'Cole')), None)
        if player is None:
            continue
        delta = 0
        for r in history:
            gw = r['gw']
            captain = next((p for p in details[gw]['lineup'] if (p.get('multiplier') or 0) > 1), None)
            actual_bonus = live[gw][captain['element']]['total_points'] * (captain['multiplier'] - 1) if captain else 0
            hypothetical_bonus = live[gw][player]['total_points'] * (2 if r['chip'] == '3xc' else 1)
            delta += hypothetical_bonus - actual_bonus
        rows.append({'id': player, 'name': label, 'delta': delta})
    return rows


def build_regrets(managers, details, elements, completed, cache, fetch):
    live_cache = cache.setdefault('regret_live', {})
    latest = max(completed, default=0)
    for gw in sorted(completed):
        saved = live_cache.get(str(gw), {})
        if not saved or gw == latest or time.time() - saved.get('at', 0) > 7 * 86400:
            payload = fetch(f'event/{gw}/live/')
            live_cache[str(gw)] = {'at': time.time(), 'stats': {str(p['id']): {k: p['stats'].get(k, 0) for k in ('total_points', 'minutes', 'red_cards', 'yellow_cards')} for p in payload['elements']}}
    live = {gw: {int(k): v for k, v in live_cache[str(gw)]['stats'].items()} for gw in completed}
    names = {p: e['web_name'] for p, e in elements.items()}
    roles = {p: e['element_type'] for p, e in elements.items()}
    result = []
    for m in managers:
        history = m['history']
        ds = {r['gw']: details.get(f"{m['id']}:{r['gw']}", {}) for r in history}
        if any(len(d.get('lineup', [])) != 15 for d in ds.values()):
            raise ValueError('Historical picks incomplete')
        candidates, bench = {}, []
        actual = sum(r['net'] for r in history)
        for r in history:
            gw, d = r['gw'], ds[r['gw']]
            active = [p for p in d['lineup'] if (p.get('multiplier') or 0) > 0]
            cap = next((p for p in active if p['multiplier'] > 1), None)
            cap_base = live[gw][cap['element']]['total_points'] if cap else 0
            bonus = 2 if r['chip'] == '3xc' else 1
            for p in active:
                pid = p['element']
                c = candidates.setdefault(pid, {'id': pid, 'name': names.get(pid, str(pid)), 'delta': 0, 'weeks': 0, 'scores': []})
                delta = (live[gw][pid]['total_points'] - cap_base) * bonus
                c['delta'] += delta
                c['weeks'] += 1
                c['scores'].append({'gw': gw, 'points': live[gw][pid]['total_points'], 'actual': cap_base, 'delta': delta})
            if r['chip'] != 'bboost':
                unused = [p['element'] for p in d['lineup'] if not p.get('multiplier')]
                if unused:
                    high = max(live[gw][pid]['total_points'] for pid in unused)
                    bench.append({'gw': gw, 'points': high, 'players': [names.get(pid, str(pid)) for pid in unused if live[gw][pid]['total_points'] == high]})
        frozen = None
        if 1 in ds and set(completed) == set(range(1, latest + 1)):
            lineup = original_lineup(ds[1])
            totals = [{'gw': gw, 'points': untouched_score(lineup, live[gw], roles)} for gw in sorted(completed)]
            frozen = {'points': sum(r['points'] for r in totals), 'weeks': totals, 'lineup': lineup,
                      'captain': names[next(p['element'] for p in lineup if p['is_captain'])],
                      'vice': names[next(p['element'] for p in lineup if p['is_vice_captain'])]}
        transfers = fetch(f"entry/{m['id']}/transfers/")
        receipts = []
        for gw in sorted({t['event'] for t in transfers if t['event'] in completed}, reverse=True):
            h = next((r for r in history if r['gw'] == gw), None)
            if not h or h['chip'] in ('freehit', 'wildcard'):
                continue
            window = [week for week in range(gw, gw + 3) if week in completed]
            moves = []
            for t in [t for t in transfers if t['event'] == gw]:
                bought, sold = t['element_in'], t['element_out']
                incoming = sum(live[w][bought]['total_points'] for w in window)
                outgoing = sum(live[w][sold]['total_points'] for w in window)
                moves.append({'in': names.get(bought, str(bought)), 'out': names.get(sold, str(sold)), 'bought': incoming, 'sold': outgoing, 'delta': incoming - outgoing})
            receipts.append({'gw': gw, 'weeks': window, 'moves': moves, 'hits': h['hits'], 'delta': sum(t['delta'] for t in moves) - h['hits']})
        result.append({'id': m['id'], 'actual': actual, 'frozen': frozen,
                       'perma_captains': perma_captains(history, ds, live, elements),
                       'captains': sorted(candidates.values(), key=lambda c: (-c['delta'], c['name'])),
                       'bench': sorted(bench, key=lambda r: -r['gw']), 'receipts': receipts})
    return {'rows': result, 'through_gw': latest, 'stale': False}


def build_untouched_live(regrets, gw, stats, elements, fixtures, managers):
    """Extend the saved GW1 comparison once, using identical GW coverage on both sides."""
    if not regrets or regrets.get('stale') or gw != regrets.get('through_gw', 0) + 1:
        return None
    roles = {pid: p['element_type'] for pid, p in elements.items()}
    remaining_teams = {team for f in fixtures if f.get('event') == gw and not f.get('finished')
                       for team in (f['team_h'], f['team_a'])}
    pending = {pid for pid, p in elements.items() if p['team'] in remaining_teams}
    by_id = {m['id']: m for m in managers}
    rows = []
    for saved in regrets['rows']:
        frozen = saved.get('frozen')
        m = by_id.get(saved['id'], {})
        team = m.get('public_team') or {}
        if not frozen or len(frozen.get('lineup', [])) != 15 or team.get('gw') != gw or team.get('stale') or not team.get('entry_history'):
            return None
        if len(team.get('players', [])) != 15 or any(p['id'] not in stats for p in team['players']):
            return None
        score = untouched_score(frozen['lineup'], stats, roles, pending)
        updated = deepcopy(frozen)
        updated['points'] += score
        updated['weeks'].append({'gw': gw, 'points': score})
        actual_gw = sum(stats[p['id']]['total_points'] * p['multiplier'] for p in team['players']) - team['entry_history'].get('event_transfers_cost', 0)
        rows.append({'id': saved['id'], 'actual': saved['actual'] + actual_gw, 'frozen': updated})
    return {'rows': rows, 'through_gw': gw, 'provisional': True, 'stale': False}
