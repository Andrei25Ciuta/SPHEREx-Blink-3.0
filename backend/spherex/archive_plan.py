"""Metadata-only IRSA discovery and reviewed download plans. No FITS is fetched by this CLI."""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
from pathlib import Path
import random
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import xml.etree.ElementTree as ET

from .observations import COLLECTIONS


def safe_url(url):
    u = urlsplit(url)
    if u.scheme != 'https' or u.hostname != 'irsa.ipac.caltech.edu' or u.port not in (None, 443) or u.username or u.password or u.fragment:
        raise ValueError('Only HTTPS IRSA archive URLs are accepted')
    return url


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_archive(url):
    return build_opener(SafeRedirect()).open(Request(safe_url(url), headers={'User-Agent': 'SPHEREx-Blink/3.0'}), timeout=30)


def metadata(url, *, sleep=time.sleep, max_attempts=8):
    """Read bounded IRSA metadata with the same capped retry policy as FITS retrieval."""
    retryable = (429, 502, 503, 504)
    for attempt in range(max_attempts):
        try:
            with open_archive(url) as response:
                data = response.read(16 * 1024 * 1024 + 1)
            if len(data) > 16 * 1024 * 1024:
                raise ValueError('Archive metadata is too large; narrow the query')
            return data
        except HTTPError as exc:
            if exc.code not in retryable or attempt == max_attempts - 1:
                raise
            retry_after = exc.headers.get('Retry-After')
            backoff = min(60.0, 3.0 * (2 ** attempt))
            try:
                retry_delay = float(retry_after) if retry_after else 0.0
            except ValueError:
                try:
                    retry_date = parsedate_to_datetime(retry_after)
                    if retry_date.tzinfo is None:
                        retry_date = retry_date.replace(tzinfo=timezone.utc)
                    retry_delay = max(0.0, (retry_date - datetime.now(timezone.utc)).total_seconds())
                except (TypeError, ValueError, OverflowError):
                    retry_delay = 0.0
            delay = max(backoff, retry_delay) + random.uniform(0, 2)
            if delay > 300:
                raise
            print(json.dumps({'event': 'metadata_retry', 'status': exc.code,
                              'attempt': attempt + 1, 'delaySeconds': round(delay, 1)}), flush=True)
            exc.close()
            sleep(delay)
        except (URLError, TimeoutError, ConnectionError) as exc:
            if attempt == max_attempts - 1:
                raise
            delay = min(60.0, 3.0 * (2 ** attempt)) + random.uniform(0, 2)
            print(json.dumps({'event': 'metadata_retry', 'error': type(exc).__name__,
                              'attempt': attempt + 1, 'delaySeconds': round(delay, 1)}), flush=True)
            sleep(delay)
    raise AssertionError('unreachable')


def votable(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML declarations are not allowed')
    root = ET.fromstring(data)
    for info in root.findall('.//{*}INFO'):
        if info.get('name') == 'QUERY_STATUS' and info.get('value') != 'OK':
            raise ValueError('Archive query failed or was truncated; narrow the query')
    table = root.find('.//{*}TABLE')
    if table is None:
        raise ValueError('No archive table')
    names = [f.get('name') for f in table.findall('{*}FIELD')]
    return [dict(zip(names, [(cell.text or '').strip() for cell in row])) for row in table.findall('.//{*}TR')]


def resolve_product(row, fetch=metadata):
    url = safe_url(row['access_url'])
    if 'datalink' in row.get('access_format', '').lower() or '/datalink/' in url:
        links = votable(fetch(url))
        links = [r for r in links if r.get('semantics', '').split('#')[-1] == 'this'
                 and 'fits' in r.get('content_type', '').lower() and r.get('access_url')]
        if len(links) != 1:
            raise ValueError('DataLink did not identify exactly one original FITS product')
        url = safe_url(links[0]['access_url'])
        size = links[0].get('content_length')
    else:
        size = float(row['access_estsize']) * 1000 if row.get('access_estsize') else None
    return url, int(size) if size else None


def _select_pass_spread(rows, count, *, newest=False):
    """Choose frames across 30-day passes, preferring the latest passes by default."""
    passes = []
    for row in rows:
        if not passes or float(row['t_min']) - float(passes[-1][-1]['t_min']) >= 30:
            passes.append([row])
        else:
            passes[-1].append(row)

    if newest:
        if len(passes) > count:
            passes = passes[-count:]
        selected = [group[-1] for group in passes]
        if len(selected) < count:
            latest_first = (row for group in reversed(passes) for row in reversed(group[:-1]))
            selected.extend(row for _, row in zip(range(count - len(selected)), latest_first))
        return sorted(selected, key=lambda row: float(row['t_min']))

    if len(passes) > count:
        indices = [round(i * (len(passes) - 1) / (count - 1)) for i in range(count)] if count > 1 else [len(passes) - 1]
        selected = [passes[index][-1] for index in dict.fromkeys(indices)]
    else:
        selected = [group[-1] for group in passes]
        # Add earlier frames from each pass in a balanced round-robin, preserving
        # the maximum number of survey epochs before deepening any single pass.
        offset = 2
        while len(selected) < count:
            added = False
            for group in passes:
                if len(group) >= offset:
                    selected.append(group[-offset])
                    added = True
                    if len(selected) == count:
                        break
            if not added:
                break
            offset += 1
    return sorted(selected, key=lambda row: float(row['t_min']))


MAX_PLAN_CANDIDATES = 24


def _utc_month(mjd):
    """Calendar month containing an archive MJD, in UTC."""
    stamp = datetime.fromtimestamp((float(mjd) - 40587) * 86400, timezone.utc)
    return stamp.strftime('%Y-%m')


def _monthly_rows(rows, count):
    """One monthly group per available month, with bounded chronological fallbacks."""
    by_month = {}
    for row in rows:
        month = _utc_month(row['t_min'])
        by_month.setdefault(month, []).append(row)
    months = sorted(by_month)
    if len(months) > count:
        months = months[-count:]
    selected = {month: by_month[month] for month in months}

    # Keep a primary candidate for every month, then allocate at most one fallback
    # per month per round. This bounds a plan at 24 candidates without allowing a
    # busy month to crowd another month out of the plan.
    ordered = {month: selected[month] for month in months}
    candidates = []
    for round_index in range(max((len(group) for group in ordered.values()), default=0)):
        for month in months:
            if round_index < len(ordered[month]) and len(candidates) < MAX_PLAN_CANDIDATES:
                candidates.append((month, ordered[month][round_index]))
    return months, candidates


def make_plan(rows, *, ra, dec, fov, detector='D2', collection='spherex_dr1', count=12,
              fetch=metadata, cutouts=False, newest=False, mjd_start=None, mjd_end=None,
              monthly=False):
    if collection not in COLLECTIONS or not (1 <= count <= 24):
        raise ValueError('Invalid collection or frame count')
    if not (0 <= ra < 360 and -90 <= dec <= 90 and 1 <= fov <= 10) or detector not in [f'D{i}' for i in range(1, 7)]:
        raise ValueError('Invalid field or detector')
    unique = {}
    for row in rows:
        if row.get('obs_collection') == collection and row.get('energy_bandpassname') == f'SPHEREx-{detector}':
            t = float(row['t_min'])
            if not math.isfinite(t):
                raise ValueError('Invalid observation time')
            unique.setdefault(row['obs_id'], row)
    rows = sorted(unique.values(), key=lambda r: float(r['t_min']))
    if mjd_start is not None:
        rows = [r for r in rows if float(r['t_min']) >= float(mjd_start)]
    if mjd_end is not None:
        rows = [r for r in rows if float(r['t_min']) < float(mjd_end)]
    if not rows:
        raise ValueError('No matching observations')
    month_candidates = None
    requested_months = None
    if monthly:
        requested_months, month_candidates = _monthly_rows(rows, count)
    elif len(rows) > count:
        rows = _select_pass_spread(rows, count, newest=newest)
    files = []
    monthly_groups = []
    source_rows = month_candidates if monthly else [(None, row) for row in rows]
    for month, row in source_rows:
        try:
            url, size = resolve_product(row, fetch)
            original_url = url
            if cutouts:
                if not urlsplit(url).path.startswith('/ibe/data/spherex/'):
                    raise ValueError('This product has no supported IBE cutout URL')
                url += ('&' if '?' in url else '?') + urlencode({'center': f'{ra:.8f},{dec:.8f}d', 'size': f'{fov / 60:.6f}'})
        except (HTTPError, URLError, TimeoutError, ConnectionError, ValueError) as exc:
            # A permanent candidate failure should only remove that candidate.
            # Keep transient archive/network failures visible to Cloud Tasks so
            # the durable request can retry instead of marking the month missing.
            transient = ((isinstance(exc, HTTPError) and exc.code in (408, 429, 500, 502, 503, 504))
                         or (not isinstance(exc, HTTPError)
                             and isinstance(exc, (URLError, TimeoutError, ConnectionError))))
            if monthly and not transient:
                continue
            raise
        item = {'obsId': row['obs_id'], 'mjd': float(row['t_min']), 'url': url,
                'name': f'input-{len(files):03}.fits' + ('.gz' if urlsplit(url).path.endswith('.gz') else ''),
                'estimatedBytes': None if cutouts else size, 'fullProductBytes': size, 'originalUrl': original_url}
        if month is not None:
            item['month'] = month
            monthly_groups.append((month, item['obsId']))
        files.append(item)
    if not files:
        raise ValueError('No matching observations')
    if monthly:
        # Failed metadata/DataLink resolution removes only that candidate. Preserve
        # the archive-ordered alternatives that remain in each calendar month.
        groups = []
        for month in requested_months:
            obs_ids = [obs_id for group_month, obs_id in monthly_groups if group_month == month]
            if obs_ids:
                groups.append({'month': month, 'obsIds': obs_ids})
        if not groups:
            raise ValueError('No matching observations')
    times = [f['mjd'] for f in files]
    result = {'version': 1, 'sequenceId': 'barnard-d2' if detector == 'D2' else 'field-' + detector.lower(),
            'collection': collection, 'query': {'ra': ra, 'dec': dec, 'fov': fov, 'det': detector},
            'passCount': 1 + sum(b-a >= 30 for a, b in zip(times, times[1:])),
            'maxFileBytes': 32 * 1024**2, 'maxTotalBytes': 128 * 1024**2,
            'files': files, 'downloadApproved': False, 'termsChecked': False, 'acknowledgement': ''}
    if monthly:
        result.update({'samplingMode': 'monthly', 'requestedMonths': requested_months,
                       'monthGroups': groups})
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--xml', type=Path, help='Read an exported VOTable instead of querying SIA')
    p.add_argument('--ra', type=float, default=269.4462)
    p.add_argument('--dec', type=float, default=4.769)
    p.add_argument('--fov', type=float, default=5)
    p.add_argument('--collection', choices=COLLECTIONS, default='spherex_dr1')
    p.add_argument('--count', type=int, default=12)
    p.add_argument('--cutouts', action='store_true', help='Plan IBE spatial cutouts; sizes unknown until measured, with explicit byte caps')
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    source = a.xml.read_bytes() if a.xml else metadata('https://irsa.ipac.caltech.edu/SIA?' + urlencode({
        'COLLECTION': a.collection, 'POS': f'circle {a.ra} {a.dec} {a.fov/120}',
        'MAXREC': 4096, 'RESPONSEFORMAT': 'votable'}))
    plan = make_plan(votable(source), ra=a.ra, dec=a.dec, fov=a.fov, collection=a.collection, count=a.count, cutouts=a.cutouts)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(plan, indent=2) + '\n')
    print(f"Metadata only: {len(plan['files'])} files, {plan['passCount']} passes; review {a.output}. No FITS downloaded.")


if __name__ == '__main__':
    main()
